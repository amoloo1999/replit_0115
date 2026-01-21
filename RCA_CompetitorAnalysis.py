#!/usr/bin/env python3
"""
RCA_CompetitorAnalysis.py

Rate Comparison Analysis tool that:
1. Takes user address input and search radius
2. Calls StorTrack API to find subject store and competitors
3. Lets user select stores for detailed rate analysis
4. Queries local database first (free), then offers API for missing data ($12.50/year)
5. Exports results to CSV with rate comparisons

Usage:
    python RCA_CompetitorAnalysis.py --address "123 Main St" --city "New York" --state "NY" --zip "10001" --radius 5
"""

import argparse
import csv
from collections import defaultdict
from dateutil.relativedelta import relativedelta
from difflib import SequenceMatcher
import json
import logging
import os
import re
import sys
import time
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

import pyodbc
import requests


# Rate limiting globals for historical API
_RATE_LIMIT_PER_HOUR = 3000
_rate_window_start = time.time()
_rate_call_count = 0


class StorTrackAPIClient:
    """Client for StorTrack API endpoints."""
    
    def __init__(self, base_url: str, username: str, password: str, timeout: int = 60):
        self.base_url = base_url.rstrip('/') + '/'
        self.username = username
        self.password = password
        self._session = requests.Session()
        self._timeout = timeout
        self._token: Optional[str] = None
    
    def _get_auth_token(self) -> Optional[str]:
        """Get authentication token from API."""
        if self._token:
            return self._token
        
        auth_url = f"{self.base_url}authtoken"
        headers = {"Content-Type": "application/x-www-form-urlencoded"}
        data = {"grant_type": "password", "username": self.username, "password": self.password}
        
        try:
            resp = self._session.post(auth_url, headers=headers, data=data, timeout=30)
            if resp.status_code == 200:
                j = resp.json()
                token = j.get('access_token') or j.get('token')
                if token:
                    self._token = f"Bearer {token}"
                    return self._token
            logging.error(f"Auth token fetch failed: status={resp.status_code}")
        except Exception as e:
            logging.error(f"Auth token exception: {e}")
        return None
    
    def find_stores_by_address(self, country: str = "United States", state: str = "", 
                               city: str = "", zip_code: str = "", store_name: str = "",
                               company_name: str = "") -> Optional[List[Dict[str, Any]]]:
        """
        Find stores by address using /storesbyaddress endpoint.
        
        Args:
            country: Full country name (mandatory, e.g., "United States")
            state: State code or name
            city: City name
            zip_code: Zip/postal code
            store_name: Store name (optional)
            company_name: Company name (optional)
        
        Returns:
            List of store dictionaries or None on error
        """
        url = f"{self.base_url}storesbyaddress"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        
        token = self._get_auth_token()
        if token:
            headers['authorization'] = token
        
        body = {
            "country": country,
            "state": state,
            "city": city,
            "zip": zip_code,
            "storename": store_name,
            "companyname": company_name
        }
        
        try:
            resp = self._session.post(url, headers=headers, json=body, timeout=self._timeout)
            if resp.status_code == 200:
                result = resp.json()
                return result.get('stores', [])
            else:
                logging.error(f"Find stores by address failed: status={resp.status_code} body={resp.text}")
        except Exception as e:
            logging.error(f"Exception calling storesbyaddress: {e}")
        return None
    
    def fetch_historical_data(self, store_id: int, from_date: str, to_date: str, 
                            max_retries: int = 3) -> Optional[List[Dict[str, Any]]]:
        """
        Fetch historical rate data using /historicaldata endpoint with rate limiting and retry logic.
        
        Implements:
        - 3000 calls/hour rate limiting (client-side)
        - Automatic retry on 429 (rate limit), 404, 500, 503
        - Progressive backoff for transient errors
        - Data loss prevention through comprehensive error handling
        
        Args:
            store_id: Single StorTrack store ID (API requires single int, not array)
            from_date: Start date in YYYY-MM-DD format
            to_date: End date in YYYY-MM-DD format
            max_retries: Maximum retry attempts (default: 3)
        
        Returns:
            List of store data with rates, or None on error
        """
        global _RATE_LIMIT_PER_HOUR, _rate_window_start, _rate_call_count
        
        url = f"{self.base_url}historicaldata"
        body = {
            "storeid": int(store_id),
            "masterid": 0,
            "from": from_date,
            "to": to_date,
            "requestyear": 0
        }
        
        for attempt in range(max_retries):
            # Rate limiting: Check if we've hit the hourly limit
            if _rate_call_count >= _RATE_LIMIT_PER_HOUR:
                elapsed = time.time() - _rate_window_start
                if elapsed < 3600.0:
                    sleep_for = 3600.0 - elapsed
                    logging.info(f"Rate limit reached ({_rate_call_count}/{_RATE_LIMIT_PER_HOUR}). Sleeping {int(sleep_for)}s")
                    time.sleep(sleep_for)
                # Reset window
                _rate_window_start = time.time()
                _rate_call_count = 0
            
            headers = {"Content-Type": "application/json", "Accept": "application/json"}
            token = self._get_auth_token()
            if token:
                headers['authorization'] = token
            
            try:
                resp = self._session.post(url, headers=headers, json=body, timeout=self._timeout)
                _rate_call_count += 1
                
                if resp.status_code == 200:
                    result = resp.json()
                    return result if isinstance(result, list) else [result]
                
                # Handle rate limiting (429)
                elif resp.status_code == 429:
                    logging.warning(f"Got 429 (rate limit) on attempt {attempt + 1}/{max_retries}")
                    # Force rate limit reset
                    elapsed = time.time() - _rate_window_start
                    if elapsed < 3600.0:
                        sleep_for = 3600.0 - elapsed
                        logging.info(f"Sleeping {int(sleep_for)}s to reset rate limit window")
                        time.sleep(sleep_for)
                    _rate_window_start = time.time()
                    _rate_call_count = 0
                    
                    if attempt < max_retries - 1:
                        continue  # Retry
                    else:
                        logging.error(f"Rate limit persisted after {max_retries} attempts")
                        return None
                
                # Handle not found (404) - may be temporary
                elif resp.status_code == 404:
                    logging.warning(f"Got 404 on attempt {attempt + 1}/{max_retries} for store {store_id}")
                    if attempt < max_retries - 1:
                        time.sleep(2 * (attempt + 1))  # Progressive backoff
                        continue  # Retry
                    else:
                        logging.error(f"Store {store_id} not found after {max_retries} attempts")
                        return None
                
                # Handle server errors (500, 503) - retry with backoff
                elif resp.status_code in [500, 503]:
                    wait_time = 5 * (attempt + 1)  # 5s, 10s, 15s
                    logging.warning(f"Got {resp.status_code} on attempt {attempt + 1}/{max_retries}, waiting {wait_time}s")
                    if attempt < max_retries - 1:
                        time.sleep(wait_time)
                        continue  # Retry
                    else:
                        logging.error(f"Server error persisted after {max_retries} attempts")
                        return None
                
                # Handle SQL timeout (400 with specific error text)
                elif resp.status_code == 400:
                    body_text = resp.text.lower()
                    if 'sql server' in body_text or 'network-related' in body_text or 'timeout' in body_text:
                        wait_time = 5 * (attempt + 1)
                        logging.warning(f"SQL timeout on attempt {attempt + 1}/{max_retries}, waiting {wait_time}s")
                        if attempt < max_retries - 1:
                            time.sleep(wait_time)
                            continue  # Retry
                        else:
                            logging.error(f"SQL timeout persisted after {max_retries} attempts")
                            return None
                    else:
                        logging.error(f"Bad request (400): {resp.text}")
                        return None  # Don't retry generic 400 errors
                
                # Other errors - don't retry
                else:
                    logging.error(f"Historical API failed: status={resp.status_code} body={resp.text}")
                    return None
                    
            except Exception as e:
                logging.error(f"Exception calling historicaldata on attempt {attempt + 1}/{max_retries}: {e}")
                if attempt < max_retries - 1:
                    time.sleep(2 * (attempt + 1))
                    continue  # Retry
                else:
                    return None
        
        return None
    
    def find_competitors(self, storeid: Optional[int] = None, masterid: Optional[int] = None,
                        coverage_zone: float = 5.0) -> Optional[Dict[str, Any]]:
        """
        Find competitors for a subject store using /findcompetitors endpoint.
        
        Args:
            storeid: StorTrack Store ID (provide either storeid or masterid)
            masterid: StorTrack Master ID
            coverage_zone: Search radius in miles (default: 5.0)
        
        Returns:
            Dictionary with subject store info and competitorstores list, or None on error
        """
        url = f"{self.base_url}findcompetitors"
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        
        token = self._get_auth_token()
        if token:
            headers['authorization'] = token
        
        # Build body with storeid or masterid arrays
        body = {
            "storeid": [int(storeid)] if storeid else [],
            "masterid": [int(masterid)] if masterid else [],
            "coveragezone": float(coverage_zone)
        }
        
        logging.debug(f"Calling /findcompetitors with body: {body}")
        
        try:
            resp = self._session.post(url, headers=headers, json=body, timeout=self._timeout)
            if resp.status_code == 200:
                result = resp.json()
                logging.debug(f"Find competitors response: {result}")
                return result
            else:
                logging.error(f"Find competitors failed: status={resp.status_code} body={resp.text}")
        except Exception as e:
            logging.error(f"Exception calling findcompetitors: {e}")
        return None


class RatesDBManager:
    """Manager for querying local Rates database."""
    
    def __init__(self, server: str, username: str, password: str, database: str = "Stortrack",
                 driver: str = "ODBC Driver 17 for SQL Server"):
        self.server = server
        self.username = username
        self.password = password
        self.database = database
        self.driver = driver
    
    def get_connection(self):
        """Get database connection."""
        conn_str = (
            f"DRIVER={{{self.driver}}};SERVER={self.server};"
            f"DATABASE={self.database};UID={self.username};PWD={self.password};"
            f"Connection Timeout=30;Command Timeout=300"
        )
        return pyodbc.connect(conn_str)
    
    def get_trailing_12_month_rates(self, store_ids: List[int], 
                                     from_date: Optional[date] = None, 
                                     to_date: Optional[date] = None) -> Tuple[Dict[int, List[Dict[str, Any]]], Dict[int, Set[date]]]:
        """
        Get all rates for stores over the trailing 12-month period.
        Also returns the dates with data for gap analysis.
        
        Args:
            store_ids: List of StorTrack store IDs
            from_date: Start date (default: 12 months ago from today)
            to_date: End date (default: today)
        
        Returns:
            Tuple of:
            - Dict mapping store_id -> list of rate records
            - Dict mapping store_id -> set of dates with data
        """
        if not store_ids:
            return {}, {}
        
        # Default to trailing 12 months (starting Dec 1, 2024)
        if to_date is None:
            to_date = date.today()
        if from_date is None:
            from_date = date(2024, 12, 1)  # Per user request: 12/1/24 to today
        
        conn = self.get_connection()
        cur = conn.cursor()
        
        rates_by_store: Dict[int, List[Dict[str, Any]]] = {sid: [] for sid in store_ids}
        dates_by_store: Dict[int, Set[date]] = {sid: set() for sid in store_ids}
        
        try:
            placeholders = ','.join('?' * len(store_ids))
            
            # Query from current year table (Rates) and prior year (Rates_2024) if needed
            tables_to_query = ['dbo.Rates']
            if from_date.year <= 2024:
                tables_to_query.append('dbo.Rates_2024')
            
            for table in tables_to_query:
                query = f"""
                SELECT 
                    Store_ID,
                    CAST(Spacetype AS VARCHAR(50)) AS Spacetype,
                    CAST(Size AS VARCHAR(50)) AS Size,
                    Regular_Rate,
                    Online_Rate,
                    CAST(Promo AS VARCHAR(MAX)) AS Promo,
                    CAST(Date_Collected AS DATE) AS Date_Collected,
                    CAST(Source_URL AS VARCHAR(MAX)) AS Source_URL,
                    CC,
                    Humidity_Controlled,
                    Drive_Up,
                    Width,
                    [Length],
                    Height,
                    Elevator,
                    Outdoor_Access,
                    Car,
                    RV,
                    Boat,
                    Other_Vehicle,
                    Power,
                    Covered
                FROM {table}
                WHERE Store_ID IN ({placeholders})
                  AND Date_Collected >= ?
                  AND Date_Collected <= ?
                  AND Regular_Rate IS NOT NULL
                ORDER BY Store_ID, Date_Collected, Size
                """
                
                params = list(store_ids) + [from_date, to_date]
                
                try:
                    cur.execute(query, params)
                    rows = cur.fetchall()
                    
                    for row in rows:
                        store_id = row[0]
                        rate_date = row[6] if isinstance(row[6], date) else datetime.strptime(str(row[6]), '%Y-%m-%d').date()
                        
                        rates_by_store[store_id].append({
                            'store_id': store_id,
                            'spacetype': row[1],
                            'size': row[2],
                            'regular_rate': float(row[3]) if row[3] is not None else None,
                            'online_rate': float(row[4]) if row[4] is not None else None,
                            'promo': row[5],
                            'date_collected': rate_date.strftime('%Y-%m-%d'),
                            'source_url': row[7],
                            'climate_controlled': bool(row[8]) if row[8] else False,
                            'humidity_controlled': bool(row[9]) if row[9] else False,
                            'drive_up': bool(row[10]) if row[10] else False,
                            'width': float(row[11]) if row[11] else None,
                            'length': float(row[12]) if row[12] else None,
                            'height': float(row[13]) if row[13] else None,
                            'elevator': bool(row[14]) if row[14] else False,
                            'outdoor_access': bool(row[15]) if row[15] else False,
                            'car': bool(row[16]) if row[16] else False,
                            'rv': bool(row[17]) if row[17] else False,
                            'boat': bool(row[18]) if row[18] else False,
                            'other_vehicle': bool(row[19]) if row[19] else False,
                            'power': bool(row[20]) if row[20] else False,
                            'covered': bool(row[21]) if row[21] else False
                        })
                        dates_by_store[store_id].add(rate_date)
                
                except Exception as e:
                    logging.warning(f"Error querying {table}: {e}")
                    continue
            
            return rates_by_store, dates_by_store
        
        except Exception as e:
            logging.error(f"Error querying trailing 12-month rates: {e}")
            return {sid: [] for sid in store_ids}, {sid: set() for sid in store_ids}
        finally:
            cur.close()
            conn.close()
    
    def get_store_info(self, store_ids: List[int]) -> Dict[int, Dict[str, Any]]:
        """Get store info from Sites table."""
        if not store_ids:
            return {}
        
        conn = self.get_connection()
        cur = conn.cursor()
        
        try:
            placeholders = ','.join('?' * len(store_ids))
            query = f"""
            SELECT 
                Store_ID, Store_Name, Street_Address, City, State, Zip
            FROM Sites.dbo.Sites
            WHERE Store_ID IN ({placeholders})
            """
            cur.execute(query, store_ids)
            rows = cur.fetchall()
            
            return {
                row[0]: {
                    'store_id': row[0],
                    'store_name': row[1],
                    'address': row[2],
                    'city': row[3],
                    'state': row[4],
                    'zip': row[5]
                }
                for row in rows
            }
        except Exception as e:
            logging.warning(f"Error getting store info from Sites: {e}")
            return {}
        finally:
            cur.close()
            conn.close()
    
    def get_latest_rates_for_stores(self, store_ids: List[int], days_back: int = 7) -> List[Dict[str, Any]]:
        """
        Get the most recent rates for a list of store IDs.
        
        Args:
            store_ids: List of StorTrack store IDs
            days_back: How many days back to search for rates (default: 7)
        
        Returns:
            List of rate dictionaries with store info
        """
        if not store_ids:
            return []
        
        conn = self.get_connection()
        cur = conn.cursor()
        
        try:
            # Build parameterized query with IN clause
            placeholders = ','.join('?' * len(store_ids))
            
            # Query most recent rates for each store within the last N days
            query = f"""
            WITH RankedRates AS (
                SELECT 
                    Store_ID,
                    CAST(Spacetype AS VARCHAR(50)) AS Spacetype,
                    CAST(Size AS VARCHAR(50)) AS Size,
                    Regular_Rate,
                    Online_Rate,
                    CAST(Promo AS VARCHAR(MAX)) AS Promo,
                    Date_Collected,
                    CAST(Source_URL AS VARCHAR(MAX)) AS Source_URL,
                    CC,
                    Humidity_Controlled,
                    Drive_Up,
                    ROW_NUMBER() OVER (PARTITION BY Store_ID, CAST(Size AS VARCHAR(50)) ORDER BY Date_Collected DESC) AS rn
                FROM dbo.Rates
                WHERE Store_ID IN ({placeholders})
                  AND Date_Collected >= DATEADD(day, -{days_back}, GETDATE())
                  AND Regular_Rate IS NOT NULL
            )
            SELECT 
                Store_ID,
                Spacetype,
                Size,
                Regular_Rate,
                Online_Rate,
                Promo,
                Date_Collected,
                Source_URL,
                CC,
                Humidity_Controlled,
                Drive_Up
            FROM RankedRates
            WHERE rn = 1
            ORDER BY Store_ID, Size
            """
            
            cur.execute(query, store_ids)
            rows = cur.fetchall()
            
            rates = []
            for row in rows:
                rates.append({
                    'store_id': row[0],
                    'spacetype': row[1],
                    'size': row[2],
                    'regular_rate': float(row[3]) if row[3] is not None else None,
                    'online_rate': float(row[4]) if row[4] is not None else None,
                    'promo': row[5],
                    'date_collected': row[6].strftime('%Y-%m-%d') if row[6] else None,
                    'source_url': row[7],
                    'climate_controlled': bool(row[8]) if row[8] else False,
                    'humidity_controlled': bool(row[9]) if row[9] else False,
                    'drive_up': bool(row[10]) if row[10] else False
                })
            
            return rates
        
        except Exception as e:
            logging.error(f"Error querying rates: {e}")
            return []
        finally:
            cur.close()
            conn.close()


def setup_logging(verbose: bool = False):
    """Setup logging configuration."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format='%(asctime)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )


def get_store_selection(subject_store: Dict[str, Any], competitors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Let user select stores from competitor list for rate analysis.
    
    Args:
        subject_store: Subject store info
        competitors: List of competitor stores
    
    Returns:
        List of selected stores (includes subject + selected competitors)
    """
    print("\n" + "=" * 80)
    print("SELECT STORES FOR RATE ANALYSIS")
    print("=" * 80)
    print("\n0. SUBJECT: " + subject_store.get('storename', 'N/A'))
    print(f"   {subject_store.get('address', '')}, {subject_store.get('city', '')}, {subject_store.get('state', '')} {subject_store.get('zip', '')}")
    
    print("\nCOMPETITORS:")
    for idx, comp in enumerate(competitors, 1):
        print(f"{idx}. {comp.get('storename', 'N/A')}")
        print(f"   {comp.get('address', '')}, {comp.get('city', '')}, {comp.get('state', '')} {comp.get('zip', '')} ({comp.get('distance', '?')} mi)")
    
    print("\n" + "-" * 80)
    print("Enter store numbers separated by commas to include in analysis.")
    print("Note: Subject store (0) will be automatically included.")
    print("Example: 1,3,5 (includes subject + competitors 1, 3, and 5)")
    
    while True:
        selection = input("\nYour selection: ").strip().lower()
        
        if selection == 'all':
            selected = [subject_store] + competitors
            break
        
        try:
            indices = [int(x.strip()) for x in selection.split(',')]
            selected = [subject_store]  # Always include subject store
            
            for idx in indices:
                if idx == 0:
                    # Subject already included, skip
                    continue
                elif 1 <= idx <= len(competitors):
                    selected.append(competitors[idx - 1])
                else:
                    print(f"Invalid number: {idx}. Use 1-{len(competitors)} for competitors.")
                    continue
            
            if len(selected) > 1:  # Must have at least subject + 1 competitor
                break
            else:
                print("Please select at least one competitor.")
        except ValueError:
            print("Invalid input. Enter numbers separated by commas (e.g., 1,3,5) or 'all'.")
    
    print(f"\n✓ Selected {len(selected)} store(s) for analysis.")
    return selected


def collect_store_metadata(selected_stores: List[Dict[str, Any]], conn) -> Dict[int, Dict[str, Any]]:
    """
    Collect Year Built and SF for all selected stores.
    Try Salesforce lookup first, then prompt for manual entry if not found.
    
    Args:
        selected_stores: List of selected store dicts
        conn: Database connection
    
    Returns:
        Dict mapping store_id -> {'year_built': int, 'square_footage': float, 'distance': str}
    """
    print("\n" + "=" * 80)
    print("COLLECT STORE METADATA (YEAR BUILT & SQUARE FOOTAGE)")
    print("=" * 80)
    
    metadata = {}
    
    for store in selected_stores:
        store_id = store.get('storeid')
        store_name = store.get('storename', 'Unknown')
        address = store.get('address', '')
        city = store.get('city', '')
        distance = store.get('distance', '')
        
        print(f"\n{store_name}")
        print(f"  {address}, {city}")
        if distance:
            print(f"  Distance: {distance} mi")
        
        # Try Salesforce lookup
        year_built = None
        square_footage = None
        
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT TOP 1 Year_Built__c, Net_RSF__c
                FROM Sites.dbo.Salesforce_rawData
                WHERE Name LIKE ?
            """, f"%{store_name}%")
            row = cur.fetchone()
            if row:
                year_built = int(row[0]) if row[0] else None
                square_footage = float(row[1]) if row[1] else None
                print(f"  ✓ Found in Salesforce: Year Built = {year_built}, SF = {square_footage:,.0f}" if square_footage else f"  ✓ Found in Salesforce: Year Built = {year_built}")
            cur.close()
        except Exception as e:
            print(f"  ! Salesforce lookup failed: {e}")
        
        # Prompt for missing values
        if year_built is None:
            while True:
                year_input = input(f"  Enter Year Built (YYYY): ").strip()
                try:
                    year_built = int(year_input)
                    if 1900 <= year_built <= 2030:
                        break
                    else:
                        print("    Invalid year. Please enter a year between 1900-2030.")
                except ValueError:
                    print("    Invalid input. Please enter a 4-digit year.")
        
        if square_footage is None:
            while True:
                sf_input = input(f"  Enter Square Footage (SF): ").strip().replace(',', '')
                try:
                    square_footage = float(sf_input)
                    if square_footage > 0:
                        break
                    else:
                        print("    Invalid SF. Please enter a positive number.")
                except ValueError:
                    print("    Invalid input. Please enter a numeric value.")
        
        metadata[store_id] = {
            'year_built': year_built,
            'square_footage': square_footage,
            'distance': distance
        }
    
    print(f"\n✓ Collected metadata for {len(metadata)} stores.")
    return metadata


def edit_store_names(selected_stores: List[Dict[str, Any]]) -> Dict[int, str]:
    """
    Let user edit store names that will appear in the CSV.
    
    Args:
        selected_stores: List of selected store dicts
    
    Returns:
        Dict mapping store_id -> custom display name
    """
    print("\n" + "=" * 80)
    print("EDIT STORE NAMES FOR CSV")
    print("=" * 80)
    print("\nYou can customize how store names appear in the CSV export.")
    print("Press Enter to keep the original name, or type a new name.\n")
    
    name_mapping = {}
    
    for idx, store in enumerate(selected_stores, 1):
        store_id = store.get('storeid')
        original_name = store.get('storename', 'Unknown')
        
        new_name = input(f"{idx}. [{original_name}] → ").strip()
        
        if new_name:
            name_mapping[store_id] = new_name
            print(f"   ✓ Changed to: {new_name}")
        else:
            name_mapping[store_id] = original_name
    
    print(f"\n✓ Store names configured.")
    return name_mapping


def calculate_age_ranking(year_built: int, current_year: int) -> int:
    """
    Calculate age ranking based on building age.
    
    Args:
        year_built: Year the building was built
        current_year: Current year
    
    Returns:
        Ranking from 1-10 (10 = newest)
    """
    age_years = current_year - year_built
    
    if age_years < 0:
        return 10  # Future building, treat as new
    elif age_years <= 10:
        return 10
    elif age_years <= 20:
        return 9
    elif age_years <= 30:
        return 8
    elif age_years <= 40:
        return 7
    elif age_years <= 50:
        return 6
    elif age_years <= 60:
        return 5
    elif age_years <= 70:
        return 4
    elif age_years <= 80:
        return 3
    elif age_years <= 90:
        return 2
    else:
        return 1


def calculate_size_ranking(square_footage: float) -> int:
    """
    Calculate size ranking based on total square footage.
    
    Args:
        square_footage: Total SF of facility
    
    Returns:
        Ranking from 4-10 (10 = smallest/most competitive)
    """
    if square_footage <= 50000:
        return 10
    elif square_footage <= 60000:
        return 9
    elif square_footage <= 70000:
        return 8
    elif square_footage <= 80000:
        return 7
    elif square_footage <= 90000:
        return 6
    elif square_footage <= 100000:
        return 5
    else:
        return 4


def collect_store_rankings(selected_stores: List[Dict[str, Any]], 
                           metadata: Dict[int, Dict[str, Any]]) -> Dict[int, Dict[str, int]]:
    """
    Collect rankings for all stores (subject + competitors).
    Age and Size are calculated automatically. Other categories are user input.
    
    Args:
        selected_stores: List of selected stores
        metadata: Store metadata with year_built and square_footage
    
    Returns:
        Dict mapping store_id -> {category: ranking}
    """
    print("\n" + "=" * 80)
    print("COLLECT STORE RANKINGS")
    print("=" * 80)
    print("\nRankings range from 1-10 (10 = best/most competitive)")
    print("Age and Size are calculated automatically based on Year Built and SF.")
    print("You will input rankings for: Location, Accessibility, VPD, Visibility & Signage, Brand, Quality")
    
    current_year = datetime.now().year
    subjective_categories = ['Location', 'Accessibility', 'VPD', 'Visibility & Signage', 'Brand', 'Quality']
    
    rankings = {}
    
    for idx, store in enumerate(selected_stores):
        store_id = store.get('storeid')
        store_name = store.get('storename', 'Unknown')
        store_meta = metadata.get(store_id, {})
        
        print(f"\n{'='*80}")
        if idx == 0:
            print(f"SUBJECT STORE: {store_name}")
        else:
            print(f"COMPETITOR {idx}: {store_name}")
        print(f"{'='*80}")
        
        # Calculate Age ranking
        year_built = store_meta.get('year_built')
        age_ranking = calculate_age_ranking(year_built, current_year) if year_built else 5
        print(f"  Year Built: {year_built} → Age Ranking: {age_ranking}")
        
        # Calculate Size ranking
        sf = store_meta.get('square_footage')
        size_ranking = calculate_size_ranking(sf) if sf else 7
        print(f"  Square Footage: {sf:,.0f} SF → Size Ranking: {size_ranking}")
        
        # Collect subjective rankings
        print(f"\n  Enter rankings (1-10) for subjective categories:")
        store_rankings = {
            'Age': age_ranking,
            'Size': size_ranking
        }
        
        for category in subjective_categories:
            while True:
                rank_input = input(f"    {category}: ").strip()
                try:
                    rank = int(rank_input)
                    if 1 <= rank <= 10:
                        store_rankings[category] = rank
                        break
                    else:
                        print("      Please enter a number between 1 and 10.")
                except ValueError:
                    print("      Invalid input. Please enter a number between 1 and 10.")
        
        rankings[store_id] = store_rankings
    
    print(f"\n✓ Rankings collected for {len(rankings)} stores.")
    return rankings


def collect_adjustment_factors() -> Dict[str, float]:
    """
    Collect additional adjustment factors (Captive Market Premium, Loss to Lease, CC Adj).
    Default to 0.00% but allow user input.
    
    Returns:
        Dict with adjustment factor percentages (as decimals, e.g., 0.05 for 5%)
    """
    print("\n" + "=" * 80)
    print("ADDITIONAL ADJUSTMENT FACTORS")
    print("=" * 80)
    print("\nEnter additional adjustment factors (default to 0% if left blank):")
    print("Enter percentages as numbers (e.g., enter '2.5' for 2.5%)")
    
    factors = {}
    factor_names = ['Captive Market Premium', 'Loss to Lease', 'CC Adj']
    
    for factor_name in factor_names:
        while True:
            input_val = input(f"  {factor_name} [0.0%]: ").strip()
            if input_val == '':
                factors[factor_name] = 0.0
                break
            try:
                pct = float(input_val)
                factors[factor_name] = pct / 100.0  # Convert to decimal
                print(f"    ✓ Set to {pct}%")
                break
            except ValueError:
                print("      Invalid input. Please enter a numeric value.")
    
    print(f"\n✓ Adjustment factors configured.")
    return factors


def fuzzy_match_score(str1: str, str2: str) -> float:
    """
    Calculate similarity score between two strings using SequenceMatcher.
    
    Args:
        str1: First string to compare
        str2: Second string to compare
    
    Returns:
        Float between 0 and 1, where 1 is perfect match
    """
    if not str1 or not str2:
        return 0.0
    return SequenceMatcher(None, str1.lower().strip(), str2.lower().strip()).ratio()


def parse_salesforce_name(salesforce_name: str) -> Tuple[Optional[str], Optional[str]]:
    """
    Parse Salesforce Name field to extract store name and address.
    
    Format: "StoreName - Street Address"
    Example: "SecureSpace - 16017 SE Division St"
    
    Args:
        salesforce_name: Full name from Salesforce_rawData.Name field
    
    Returns:
        Tuple of (store_name, street_address) or (None, None) if parse fails
    """
    if not salesforce_name or ' - ' not in salesforce_name:
        return None, None
    
    parts = salesforce_name.split(' - ', 1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return None, None


def fetch_salesforce_matches(db_server: str, db_user: str, db_pass: str,
                             store_name: str, street_address: str,
                             top_n: int = 5) -> List[Dict[str, Any]]:
    """
    Fetch potential Salesforce matches for a store based on name and address.
    Only returns records where both Net_RSF_c and Year_Built_c are NOT NULL.
    
    Args:
        db_server: Database server address
        db_user: Database username
        db_pass: Database password
        store_name: Store name to match
        street_address: Street address to match
        top_n: Number of top matches to return (default 5)
    
    Returns:
        List of matching records with similarity scores
    """
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={db_server};"
        f"DATABASE=Sites;UID={db_user};PWD={db_pass};"
        f"Connection Timeout=30;Command Timeout=300"
    )
    
    try:
        conn = pyodbc.connect(conn_str)
        cur = conn.cursor()
        
        # Query Salesforce table - only records with both SF and Year Built
        # ShippingAddress is a complex field in format: {'street': '2227 San Pablo Ave.', 'city': 'Oakland', ...}
        query = """
            SELECT Name, Net_RSF__c, Year_Built__c, ShippingAddress
            FROM dbo.Salesforce_rawData
            WHERE Net_RSF__c IS NOT NULL 
              AND Year_Built__c IS NOT NULL
              AND Name IS NOT NULL
        """
        
        cur.execute(query)
        rows = cur.fetchall()
        
        matches = []
        for row in rows:
            sf_name = row[0]
            sf_sqft = row[1]
            sf_year = row[2]
            shipping_address = row[3]
            
            # Extract store brand from Name field (before the dash)
            sf_store_brand = sf_name.split(' - ')[0].strip() if ' - ' in sf_name else sf_name
            
            # Parse shipping address to get street
            sf_street = ''
            if shipping_address and isinstance(shipping_address, str):
                # ShippingAddress is stored as string representation of dict
                import ast
                try:
                    addr_dict = ast.literal_eval(shipping_address)
                    sf_street = addr_dict.get('street', '') if isinstance(addr_dict, dict) else ''
                except Exception as e:
                    # If parsing fails, try to extract street from raw string
                    logging.debug(f"Failed to parse ShippingAddress for {sf_name}: {e}")
                    if 'street' in shipping_address.lower():
                        street_match = re.search(r"'street':\s*'([^']*)'", shipping_address)
                        if street_match:
                            sf_street = street_match.group(1)
            
            # Fallback: if no ShippingAddress, try to extract address from Name field
            # Format could be "StorQuest - Oakland / San Pablo" or "Store Name - Street Address"
            if not sf_street and ' - ' in sf_name:
                name_parts = sf_name.split(' - ', 1)
                if len(name_parts) == 2:
                    potential_address = name_parts[1].strip()
                    # Check if it looks like an address (contains numbers or common street suffixes)
                    if re.search(r'\d+', potential_address) or any(suffix in potential_address.lower() for suffix in ['st', 'ave', 'rd', 'blvd', 'dr', 'way', 'lane', 'court']):
                        sf_street = potential_address
            
            if not sf_street:
                continue
            
            # Calculate fuzzy match scores
            # For name matching, check both full name and brand
            name_score_full = fuzzy_match_score(store_name, sf_name)
            name_score_brand = fuzzy_match_score(store_name, sf_store_brand)
            name_score = max(name_score_full, name_score_brand)
            
            # Normalize addresses for better matching (remove periods, extra spaces)
            normalized_input_addr = re.sub(r'[.,]', '', street_address.lower().strip())
            normalized_sf_addr = re.sub(r'[.,]', '', sf_street.lower().strip())
            # Also normalize "Avenue" vs "Ave", "Street" vs "St", etc.
            normalized_input_addr = re.sub(r'\bavenue\b', 'ave', normalized_input_addr)
            normalized_input_addr = re.sub(r'\bstreet\b', 'st', normalized_input_addr)
            normalized_sf_addr = re.sub(r'\bavenue\b', 'ave', normalized_sf_addr)
            normalized_sf_addr = re.sub(r'\bstreet\b', 'st', normalized_sf_addr)
            
            address_score = fuzzy_match_score(normalized_input_addr, normalized_sf_addr)
            
            # Combined score (weighted: 40% name, 60% address)
            combined_score = (name_score * 0.4) + (address_score * 0.6)
            
            # Convert to proper types
            try:
                sf_sqft_float = float(sf_sqft) if sf_sqft is not None else None
            except (ValueError, TypeError):
                sf_sqft_float = None
            
            try:
                sf_year_int = int(sf_year) if sf_year is not None else None
            except (ValueError, TypeError):
                sf_year_int = None
            
            matches.append({
                'salesforce_name': sf_name,
                'parsed_store_name': sf_store_brand,
                'parsed_address': sf_street,
                'square_footage': sf_sqft_float,
                'year_built': sf_year_int,
                'name_score': name_score,
                'address_score': address_score,
                'combined_score': combined_score
            })
        
        cur.close()
        conn.close()
        
        # Sort by combined score descending and return top N
        matches.sort(key=lambda x: x['combined_score'], reverse=True)
        return matches[:top_n]
    
    except Exception as e:
        logging.error(f"Error fetching Salesforce matches: {e}")
        return []


def prompt_for_salesforce_match(store: Dict[str, Any], matches: List[Dict[str, Any]]) -> Tuple[Optional[float], Optional[int]]:
    """
    Display top Salesforce matches and prompt user to select one or enter manually.
    
    Args:
        store: Store dict with storename and address
        matches: List of Salesforce match dicts
    
    Returns:
        Tuple of (square_footage, year_built) or (None, None) if no match/manual entry
    """
    store_name = store.get('storename', 'Unknown')
    store_address = store.get('address', 'Unknown')
    
    print(f"\n{'='*80}")
    print(f"SALESFORCE LOOKUP: {store_name}")
    print(f"Address: {store_address}")
    print(f"{'='*80}")
    
    if not matches:
        print("\n⚠️  No Salesforce matches found with both Square Footage and Year Built data.")
        print("\nWould you like to enter these values manually?")
        response = input("Enter manually? [Y/N]: ").strip().upper()
        
        if response == 'Y':
            return prompt_manual_entry()
        else:
            print("   Skipping - SF and Year Built will be blank for this store.")
            return None, None
    
    # Display top 3 matches
    print(f"\nTop {min(3, len(matches))} matches found:")
    for idx, match in enumerate(matches[:3], 1):
        print(f"\n{idx}. {match['salesforce_name']}")
        print(f"   Store: {match['parsed_store_name']}")
        print(f"   Address: {match['parsed_address']}")
        
        # Safely format SF and Year
        sf_display = f"{match['square_footage']:,.0f}" if match['square_footage'] is not None else 'N/A'
        year_display = str(match['year_built']) if match['year_built'] is not None else 'N/A'
        
        print(f"   SF: {sf_display} | Year Built: {year_display}")
        print(f"   Match Score: {match['combined_score']:.1%} (Name: {match['name_score']:.1%}, Address: {match['address_score']:.1%})")
    
    print(f"\n4. None of these - Enter manually")
    print(f"5. Skip - Leave blank")
    
    while True:
        try:
            selection = input(f"\nSelect option (1-5) [1]: ").strip()
            if not selection:
                selection = "1"
            
            choice = int(selection)
            
            if 1 <= choice <= min(3, len(matches)):
                # User selected a match
                selected = matches[choice - 1]
                print(f"   ✓ Selected: {selected['salesforce_name']}")
                return selected['square_footage'], selected['year_built']
            elif choice == 4:
                # Manual entry
                return prompt_manual_entry()
            elif choice == 5:
                # Skip
                print("   Skipping - SF and Year Built will be blank for this store.")
                return None, None
            else:
                print(f"Please enter a number between 1 and 5")
        except ValueError:
            print("Invalid input. Please enter a number.")


def prompt_manual_entry() -> Tuple[Optional[float], Optional[int]]:
    """
    Prompt user to manually enter square footage and year built.
    
    Returns:
        Tuple of (square_footage, year_built)
    """
    print("\n--- Manual Entry ---")
    
    while True:
        try:
            sf_input = input("Enter Square Footage (or press Enter to skip): ").strip()
            if not sf_input:
                sf = None
                break
            sf = float(sf_input.replace(',', ''))
            if sf <= 0:
                print("Please enter a positive number")
                continue
            break
        except ValueError:
            print("Invalid input. Please enter a number.")
    
    while True:
        try:
            year_input = input("Enter Year Built (or press Enter to skip): ").strip()
            if not year_input:
                year = None
                break
            year = int(year_input)
            if year < 1800 or year > datetime.now().year + 5:
                print(f"Please enter a reasonable year (1800-{datetime.now().year + 5})")
                continue
            break
        except ValueError:
            print("Invalid input. Please enter a 4-digit year.")
    
    if sf is not None or year is not None:
        print(f"   ✓ Entered: SF={sf if sf else 'N/A'}, Year={year if year else 'N/A'}")
    
    return sf, year


def lookup_store_metadata(selected_stores: List[Dict[str, Any]], 
                          db_server: str, db_user: str, db_pass: str) -> Dict[int, Dict[str, Any]]:
    """
    Look up square footage and year built for each selected store.
    
    Args:
        selected_stores: List of selected store dicts
        db_server: Database server
        db_user: Database username
        db_pass: Database password
    
    Returns:
        Dict mapping store_id -> {'square_footage': float, 'year_built': int}
    """
    print("\n" + "=" * 80)
    print("STORE METADATA LOOKUP")
    print("=" * 80)
    print("\nLooking up Square Footage and Year Built from Salesforce data...")
    
    metadata = {}
    
    for store in selected_stores:
        store_id = store.get('storeid')
        store_name = store.get('storename', '')
        street_address = store.get('address', '')
        distance = store.get('distance', '')
        
        # Fetch potential matches from Salesforce
        matches = fetch_salesforce_matches(db_server, db_user, db_pass, 
                                          store_name, street_address, top_n=5)
        
        # Prompt user to select or enter manually
        sf, year = prompt_for_salesforce_match(store, matches)
        
        metadata[store_id] = {
            'square_footage': sf,
            'year_built': year,
            'distance': distance
        }
    
    print(f"\n✓ Metadata lookup complete for {len(metadata)} store(s).")
    return metadata


def suggest_feature_code(feature_text: str) -> str:
    """
    Auto-detect and suggest a feature code based on feature text.
    
    Codes:
    - GLCC = Ground Level Climate Controlled
    - GNCC = Ground Level Non-Climate Controlled  
    - ECC = Elevator Climate Controlled
    - ENCC = Elevator Non-Climate Controlled
    - DUCC = Drive-Up Climate Controlled
    - DU = Drive-Up (Non-Climate)
    - ICC = Interior Climate Controlled
    - INCC = Interior Non-Climate Controlled
    
    Args:
        feature_text: Raw feature string from API or generated from DB
    
    Returns:
        Suggested code string
    """
    if not feature_text:
        return "UNKNOWN"
    
    feature_lower = feature_text.lower()
    
    # Check for climate control
    is_climate = 'climate' in feature_lower and 'non-climate' not in feature_lower
    is_non_climate = 'non-climate' in feature_lower or ('climate' not in feature_lower)
    
    # Check for access type
    is_drive_up = 'drive' in feature_lower
    is_elevator = 'elevator' in feature_lower
    is_ground = 'ground' in feature_lower or 'first floor' in feature_lower
    is_interior = 'interior' in feature_lower
    
    # Determine code
    if is_drive_up:
        if is_climate:
            return "DUCC"
        else:
            return "DU"
    elif is_elevator:
        if is_climate:
            return "ECC"
        else:
            return "ENCC"
    elif is_ground:
        if is_climate:
            return "GLCC"
        else:
            return "GNCC"
    elif is_interior:
        if is_climate:
            return "ICC"
        else:
            return "INCC"
    else:
        # Default based on climate only
        if is_climate:
            return "CC"
        else:
            return "NCC"


def edit_feature_codes(records: List[Dict[str, Any]]) -> Dict[str, str]:
    """
    Let user assign custom codes to each unique tag string.
    
    Args:
        records: List of rate records with 'tag' field
    
    Returns:
        Dict mapping original tag string -> user-assigned code
    """
    # Get unique tags (the classification strings like "Drive-Up / Climate Controlled")
    unique_tags = sorted(set(r.get('tag', '') for r in records if r.get('tag')))
    
    if not unique_tags:
        print("\nNo tags found in records.")
        return {}
    
    print("\n" + "=" * 80)
    print("ASSIGN TAG CODES FOR CSV")
    print("=" * 80)
    print("\nAssign a code to each unique unit classification. Available preset codes:")
    print("  GLCC  = Ground Level Climate Controlled")
    print("  GNCC  = Ground Level Non-Climate Controlled")
    print("  ECC   = Elevator Climate Controlled")
    print("  ENCC  = Elevator Non-Climate Controlled")
    print("  DUCC  = Drive-Up Climate Controlled")
    print("  DU    = Drive-Up (Non-Climate)")
    print("  ICC   = Interior Climate Controlled")
    print("  INCC  = Interior Non-Climate Controlled")
    print("  Or enter your own custom code")
    print("\nPress Enter to accept the suggested code, or type your own.\n")
    
    tag_mapping = {}
    
    for idx, tag in enumerate(unique_tags, 1):
        suggested = suggest_feature_code(tag)
        
        # Truncate long tag text for display
        display_tag = tag if len(tag) <= 60 else tag[:57] + "..."
        
        print(f"{idx}. Tag: \"{display_tag}\"")
        user_input = input(f"   Code [{suggested}]: ").strip().upper()
        
        if user_input:
            tag_mapping[tag] = user_input
            print(f"   ✓ Assigned: {user_input}")
        else:
            tag_mapping[tag] = suggested
            print(f"   ✓ Using suggested: {suggested}")
        print()
    
    print(f"✓ Tag codes configured for {len(tag_mapping)} unique tags.")
    return tag_mapping


def filter_unit_type(records: List[Dict[str, Any]], unit_type: str = "Unit") -> List[Dict[str, Any]]:
    """
    Filter records to only include specified unit type.
    
    Args:
        records: List of rate records
        unit_type: Unit type to keep (default: "Unit")
    
    Returns:
        Filtered list of records
    """
    filtered = [r for r in records if r.get('unit_type', '').lower() == unit_type.lower()]
    excluded = len(records) - len(filtered)
    
    if excluded > 0:
        print(f"\n📋 Filtered to unittype='{unit_type}': kept {len(filtered)} records, excluded {excluded}")
    
    return filtered


def apply_name_mapping(records: List[Dict[str, Any]], name_mapping: Dict[int, str]) -> List[Dict[str, Any]]:
    """
    Apply custom store names to records.
    
    Args:
        records: List of rate records
        name_mapping: Dict mapping store_id -> custom name
    
    Returns:
        Records with updated store names
    """
    for record in records:
        store_id = record.get('store_id')
        if store_id in name_mapping:
            record['store_name'] = name_mapping[store_id]
    return records


def apply_feature_mapping(records: List[Dict[str, Any]], feature_mapping: Dict[str, str]) -> List[Dict[str, Any]]:
    """
    Apply custom feature codes to the 'tag' field.
    
    Args:
        records: List of rate records
        feature_mapping: Dict mapping original tag string -> user-assigned code
    
    Returns:
        Records with updated tag codes
    """
    for record in records:
        original_tag = record.get('tag', '')
        if original_tag in feature_mapping:
            record['tag'] = feature_mapping[original_tag]
    return records


def analyze_date_gaps(dates_by_store: Dict[int, Set[date]], 
                      from_date: date, to_date: date) -> Dict[int, List[date]]:
    """
    Analyze gaps in rate data for each store.
    
    Args:
        dates_by_store: Dict mapping store_id -> set of dates with data
        from_date: Analysis start date
        to_date: Analysis end date
    
    Returns:
        Dict mapping store_id -> list of missing dates
    """
    # Generate full date range
    all_dates = set()
    current = from_date
    while current <= to_date:
        all_dates.add(current)
        current += timedelta(days=1)
    
    # Find missing dates per store
    gaps = {}
    for store_id, store_dates in dates_by_store.items():
        missing = sorted(all_dates - store_dates)
        gaps[store_id] = missing
    
    return gaps


def display_gap_analysis(selected_stores: List[Dict[str, Any]], 
                        gaps_by_store: Dict[int, List[date]],
                        from_date: date, to_date: date) -> Tuple[List[int], int]:
    """
    Display gap analysis and let user decide which stores to fetch via API.
    
    Args:
        selected_stores: List of selected store dicts
        gaps_by_store: Dict mapping store_id -> list of missing dates
        from_date: Analysis start date
        to_date: Analysis end date
    
    Returns:
        Tuple of (list of store_ids to fetch via API, total API days requested)
    """
    total_days = (to_date - from_date).days + 1
    cost_per_year = 12.50  # API cost is $12.50 per year of historical data per store
    
    print("\n" + "=" * 80)
    print("DATABASE COVERAGE ANALYSIS")
    print(f"Period: {from_date.strftime('%Y-%m-%d')} to {to_date.strftime('%Y-%m-%d')} ({total_days} days)")
    print("=" * 80)
    
    stores_with_gaps = []
    total_api_days = 0
    
    for store in selected_stores:
        store_id = store.get('storeid')
        store_name = store.get('storename', 'Unknown')
        missing_dates = gaps_by_store.get(store_id, [])
        coverage_days = total_days - len(missing_dates)
        coverage_pct = (coverage_days / total_days) * 100 if total_days > 0 else 0
        
        status = "✓ Complete" if not missing_dates else f"⚠ {len(missing_dates)} days missing"
        print(f"\n{store_name} (ID: {store_id})")
        print(f"   DB Coverage: {coverage_days}/{total_days} days ({coverage_pct:.1f}%) - {status}")
        
        if missing_dates:
            stores_with_gaps.append((store_id, store_name, missing_dates))
            total_api_days += len(missing_dates)
            
            # Show date ranges for missing data
            if len(missing_dates) <= 5:
                date_str = ", ".join(d.strftime('%m/%d') for d in missing_dates)
            else:
                # Group into ranges
                ranges = []
                start = missing_dates[0]
                end = missing_dates[0]
                for d in missing_dates[1:]:
                    if (d - end).days == 1:
                        end = d
                    else:
                        ranges.append((start, end))
                        start = end = d
                ranges.append((start, end))
                
                range_strs = []
                for s, e in ranges[:3]:
                    if s == e:
                        range_strs.append(s.strftime('%m/%d'))
                    else:
                        range_strs.append(f"{s.strftime('%m/%d')}-{e.strftime('%m/%d')}")
                date_str = ", ".join(range_strs)
                if len(ranges) > 3:
                    date_str += f" (+{len(ranges) - 3} more ranges)"
            
            print(f"   Missing: {date_str}")
    
    if not stores_with_gaps:
        print("\n✓ All selected stores have complete rate data in the database!")
        return [], 0
    
    # Calculate and show cost warning
    # Group API days by year to calculate cost
    years_needed = set()
    for store_id, store_name, missing_dates in stores_with_gaps:
        for d in missing_dates:
            years_needed.add(d.year)
    
    estimated_cost = len(years_needed) * len(stores_with_gaps) * cost_per_year
    
    print("\n" + "=" * 80)
    print("⚠️  API FETCH WARNING")
    print("=" * 80)
    print(f"\nStores with missing data: {len(stores_with_gaps)}")
    print(f"Years of data needed: {len(years_needed)} ({', '.join(map(str, sorted(years_needed)))}))")
    print(f"Total API requests needed: {total_api_days} store-days across {len(years_needed)} year(s)")
    print(f"Estimated cost: ${estimated_cost:,.2f} (at ${cost_per_year}/year per store)")
    print("\nNote: API fetches are billed per year of historical data per store.")
    
    print("\nOptions:")
    print("  [Y] Yes - Fetch ALL missing data via API")
    print("  [N] No - Skip API fetch, use DB data only")
    print("  [S] Select - Choose specific stores to fetch")
    
    while True:
        choice = input("\nYour choice [Y/N/S]: ").strip().upper()
        
        if choice == 'N':
            print("Skipping API fetch. Will export DB data only.")
            return [], 0
        
        elif choice == 'Y':
            confirm = input(f"\nConfirm API fetch for ${estimated_cost:,.2f}? [yes/no]: ").strip().lower()
            if confirm == 'yes':
                return [s[0] for s in stores_with_gaps], total_api_days
            else:
                print("API fetch cancelled.")
                return [], 0
        
        elif choice == 'S':
            print("\nSelect stores to fetch via API (enter numbers separated by commas):")
            for idx, (sid, name, missing) in enumerate(stores_with_gaps, 1):
                days = len(missing)
                store_years = set(d.year for d in missing)
                cost = len(store_years) * cost_per_year
                print(f"  {idx}. {name}: {days} days across {len(store_years)} year(s) (${cost:,.2f})")
            
            sel_input = input("\nStores to fetch: ").strip()
            try:
                sel_indices = [int(x.strip()) - 1 for x in sel_input.split(',')]
                selected_api_stores = []
                selected_api_days = 0
                
                for idx in sel_indices:
                    if 0 <= idx < len(stores_with_gaps):
                        sid, name, missing = stores_with_gaps[idx]
                        selected_api_stores.append(sid)
                        selected_api_days += len(missing)
                
                if selected_api_stores:
                    # Calculate years needed for selected stores
                    sel_years = set()
                    for idx in sel_indices:
                        if 0 <= idx < len(stores_with_gaps):
                            sid, name, missing = stores_with_gaps[idx]
                            for d in missing:
                                sel_years.add(d.year)
                    sel_cost = len(sel_years) * len(selected_api_stores) * cost_per_year
                    confirm = input(f"\nConfirm API fetch for {len(selected_api_stores)} stores (${sel_cost:,.2f})? [yes/no]: ").strip().lower()
                    if confirm == 'yes':
                        return selected_api_stores, selected_api_days
                    else:
                        print("API fetch cancelled.")
                        return [], 0
                else:
                    print("No valid stores selected.")
            except ValueError:
                print("Invalid input.")
        else:
            print("Invalid choice. Enter Y, N, or S.")


def parse_api_rate_data(api_data: List[Dict[str, Any]], 
                        store_info_map: Optional[Dict[int, Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    """
    Parse API historical data response into rate records for CSV.
    
    API returns:
    - storeID, storeName, address, city, state, zipcode, etc.
    - unitType array with: type, size, feature (text), price array
    - price array with: date, regular, online, promo
    
    Args:
        api_data: List of store data from API
        store_info_map: Optional dict mapping store_id -> store info (including distance)
    
    Returns:
        List of flattened rate records
    """
    records = []
    
    for store in api_data:
        store_id = store.get('storeID')
        store_name = store.get('storeName', '')
        address = store.get('address', '')
        city = store.get('city', '')
        state = store.get('state', '')
        zipcode = store.get('zipcode', '')
        
        # Get distance from store_info_map if available
        distance = ''
        if store_info_map and store_id in store_info_map:
            distance = store_info_map[store_id].get('distance', '')
        
        unit_types = store.get('unitType', [])
        
        for unit in unit_types:
            unit_type = unit.get('type', '')
            size_str = unit.get('size', '')
            feature_text = unit.get('feature', '')
            
            # Parse size string (e.g., "10x10", "5x5x8")
            width, length, height = None, None, None
            size_match = re.match(r'(\d+(?:\.\d+)?)\s*[xX]\s*(\d+(?:\.\d+)?)(?:\s*[xX]\s*(\d+(?:\.\d+)?))?', size_str)
            if size_match:
                width = float(size_match.group(1))
                length = float(size_match.group(2))
                if size_match.group(3):
                    height = float(size_match.group(3))
            
            # Parse feature text into binary flags
            feature_lower = feature_text.lower() if feature_text else ''
            climate_controlled = 'climate' in feature_lower or 'cc' in feature_lower
            humidity_controlled = 'humidity' in feature_lower
            drive_up = 'drive' in feature_lower
            indoor = 'inside' in feature_lower or 'indoor' in feature_lower
            outdoor = 'outdoor' in feature_lower
            first_floor = 'ground' in feature_lower or 'first floor' in feature_lower
            elevator = 'elevator' in feature_lower
            
            prices = unit.get('price', [])
            
            for price in prices:
                price_date = price.get('date', '')
                regular_rate = price.get('regular')
                online_rate = price.get('online')
                promo = price.get('promo', '')
                
                # Calculate % difference
                pct_diff = None
                if regular_rate and online_rate and regular_rate > 0:
                    pct_diff = ((regular_rate - online_rate) / regular_rate) * 100
                
                records.append({
                    'store_id': store_id,
                    'store_name': store_name,
                    'address': address,
                    'city': city,
                    'state': state,
                    'zip': zipcode,
                    'distance': distance,
                    'unit_type': unit_type,
                    'size': size_str,
                    'width': width,
                    'length': length,
                    'height': height,
                    'features': feature_text,
                    'climate_controlled': climate_controlled,
                    'humidity_controlled': humidity_controlled,
                    'drive_up': drive_up,
                    'indoor': indoor,
                    'outdoor': outdoor,
                    'first_floor': first_floor,
                    'elevator': elevator,
                    'walk_in_price': regular_rate,
                    'online_price': online_rate,
                    'pct_difference': pct_diff,
                    'date': price_date,
                    'promo': promo,
                    'source': 'API'
                })
    
    return records


def build_tag_string_from_db(rate: Dict[str, Any]) -> str:
    """
    Build a tag classification string from DB boolean fields.
    Used for the 'tag' column which gets user-assigned codes (GLCC, ECC, etc.)
    
    Logic:
    - If Drive_Up=1, Car=1, RV=1, Boat=1, or Other_Vehicle=1 → "Drive-Up"
    - Else if Elevator=1 → "Elevator"
    - Else → "Ground Level"
    
    Climate:
    - If CC=1 → "Climate Controlled"
    - Elif Humidity_Controlled=1 → "Humidity Controlled"
    - Else → "Non-Climate"
    """
    is_cc = rate.get('climate_controlled', False)
    is_humidity = rate.get('humidity_controlled', False)
    is_drive_up = rate.get('drive_up', False)
    is_elevator = rate.get('elevator', False)
    is_car = rate.get('car', False)
    is_rv = rate.get('rv', False)
    is_boat = rate.get('boat', False)
    is_other_vehicle = rate.get('other_vehicle', False)
    
    # Determine access type
    # If any vehicle type = 1, it's Drive-Up
    if is_drive_up or is_car or is_rv or is_boat or is_other_vehicle:
        access_type = "Drive-Up"
    elif is_elevator:
        access_type = "Elevator"
    else:
        access_type = "Ground Level"
    
    # Determine climate type
    if is_cc:
        climate_type = "Climate Controlled"
    elif is_humidity:
        climate_type = "Humidity Controlled"
    else:
        climate_type = "Non-Climate"
    
    return f"{access_type} / {climate_type}"


def build_amenities_string_from_db(rate: Dict[str, Any]) -> str:
    """
    Build a detailed amenities string from DB boolean fields.
    Used for the 'feature' column in the CSV.
    
    Amenities logic:
    - Outdoor_Access=1 → "Outdoor Access", =0 → "Indoor Access"
    - Power=1 → "Power"
    - Covered=1 → "Covered", =0 → "Not Covered"
    - Drive_Up=1 → "Drive Up Access"
    - Elevator=1 → "Elevator Access"
    - If elevator=0 AND drive_up=0 AND car=0 AND rv=0 AND boat=0 AND other_vehicle=0 → "Ground Floor Access"
    - Car=1 → "Vehicle Parking"
    - RV=1 → "RV Parking"
    - Boat=1 → "Boat Parking"
    - Other_Vehicle=1 → "Other Parking"
    """
    amenities = []
    
    is_climate_controlled = rate.get('climate_controlled', False)
    is_outdoor = rate.get('outdoor_access', False)
    is_power = rate.get('power', False)
    is_covered = rate.get('covered', False)
    is_drive_up = rate.get('drive_up', False)
    is_elevator = rate.get('elevator', False)
    is_car = rate.get('car', False)
    is_rv = rate.get('rv', False)
    is_boat = rate.get('boat', False)
    is_other_vehicle = rate.get('other_vehicle', False)
    
    # Climate Control
    if is_climate_controlled:
        amenities.append("Climate Controlled")
    
    # Indoor/Outdoor Access
    if is_outdoor:
        amenities.append("Outdoor Access")
    else:
        amenities.append("Indoor Access")
    
    # Power
    if is_power:
        amenities.append("Power")
    
    # Covered/Not Covered
    if is_covered:
        amenities.append("Covered")
    else:
        amenities.append("Not Covered")
    
    # Access type
    if is_drive_up:
        amenities.append("Drive Up Access")
    elif is_elevator:
        amenities.append("Elevator Access")
    elif not is_car and not is_rv and not is_boat and not is_other_vehicle:
        amenities.append("Ground Floor Access")
    
    # Vehicle parking types
    if is_car:
        amenities.append("Vehicle Parking")
    if is_rv:
        amenities.append("RV Parking")
    if is_boat:
        amenities.append("Boat Parking")
    if is_other_vehicle:
        amenities.append("Other Parking")
    
    return ", ".join(amenities)


def convert_db_rates_to_records(rates_by_store: Dict[int, List[Dict[str, Any]]], 
                                 store_info: Dict[int, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert DB rate records to standard format for CSV export.
    
    Args:
        rates_by_store: Dict mapping store_id -> list of rate dicts
        store_info: Dict mapping store_id -> store info dict
    
    Returns:
        List of standardized rate records
    """
    records = []
    
    for store_id, rates in rates_by_store.items():
        info = store_info.get(store_id, {})
        store_name = info.get('store_name', '')
        address = info.get('address', '')
        city = info.get('city', '')
        state = info.get('state', '')
        zipcode = info.get('zip', '')
        
        for rate in rates:
            regular_rate = rate.get('regular_rate')
            online_rate = rate.get('online_rate')
            
            # Calculate % difference
            pct_diff = None
            if regular_rate and online_rate and regular_rate > 0:
                pct_diff = ((regular_rate - online_rate) / regular_rate) * 100
            
            # Build amenities string for 'features' column
            amenities_str = build_amenities_string_from_db(rate)
            # Build tag string for classification (user will assign codes like GLCC, ECC)
            tag_str = build_tag_string_from_db(rate)
            
            records.append({
                'store_id': store_id,
                'store_name': store_name,
                'address': address,
                'city': city,
                'state': state,
                'zip': zipcode,
                'distance': info.get('distance', ''),
                'unit_type': rate.get('spacetype', ''),
                'size': rate.get('size', ''),
                'width': rate.get('width'),
                'length': rate.get('length'),
                'height': rate.get('height'),
                'features': amenities_str,
                'tag': tag_str,
                'climate_controlled': rate.get('climate_controlled', False),
                'humidity_controlled': rate.get('humidity_controlled', False),
                'drive_up': rate.get('drive_up', False),
                'elevator': rate.get('elevator', False),
                'outdoor_access': rate.get('outdoor_access', False),
                'car': rate.get('car', False),
                'rv': rate.get('rv', False),
                'boat': rate.get('boat', False),
                'other_vehicle': rate.get('other_vehicle', False),
                'power': rate.get('power', False),
                'covered': rate.get('covered', False),
                'walk_in_price': regular_rate,
                'online_price': online_rate,
                'pct_difference': pct_diff,
                'date': rate.get('date_collected', ''),
                'promo': rate.get('promo', ''),
                'source': 'Database'
            })
    
    return records


def export_to_csv(records: List[Dict[str, Any]], output_path: str, 
                  store_metadata: Optional[Dict[int, Dict[str, Any]]] = None):
    """
    Export rate records to CSV file.
    
    Columns: competitorstorename, address, SF, Year Built, unitsize, unittype, feature,
             walkingprice, onlineprice, % Diff, dateprice, promo, tag
    
    Args:
        records: List of rate record dicts
        output_path: Path to output CSV file
        store_metadata: Optional dict mapping store_id -> {'square_footage': float, 'year_built': int}
    """
    if not records:
        print("No records to export.")
        return
    
    # Sort by store name, then date, then size
    records.sort(key=lambda r: (r.get('store_name', ''), r.get('date', ''), r.get('size', '')))
    
    fieldnames = [
        'Store Name',
        'ADDRESS',
        'UNIT SIZE',
        'UNIT TYPE',
        'UNIT FEATURE',
        'REGULAR PRICE',
        'ONLINE PRICE',
        '% Difference',
        'Price Capture Date',
        'PROMOTION',
        'TAG'
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        for rec in records:
            pct_diff = rec.get('pct_difference')
            pct_str = f"{pct_diff:.1f}%" if pct_diff is not None else ''
            
            # Use street address only (no city, state, zip)
            street_address = rec.get('address', '')
            
            # Get metadata for this store
            store_id = rec.get('store_id')
            sf_value = ''
            year_value = ''
            if store_metadata and store_id in store_metadata:
                metadata = store_metadata[store_id]
                sf = metadata.get('square_footage')
                year = metadata.get('year_built')
                if sf is not None:
                    sf_value = f"{sf:,.0f}"
                if year is not None:
                    year_value = str(year)
            
            writer.writerow({
                'Store Name': rec.get('store_name', ''),
                'ADDRESS': street_address,
                'UNIT SIZE': rec.get('size', ''),
                'UNIT TYPE': rec.get('unit_type', ''),
                'UNIT FEATURE': rec.get('features', ''),
                'REGULAR PRICE': f"${rec['walk_in_price']:.2f}" if rec.get('walk_in_price') else '',
                'ONLINE PRICE': f"${rec['online_price']:.2f}" if rec.get('online_price') else '',
                '% Difference': pct_str,
                'Price Capture Date': rec.get('date', ''),
                'PROMOTION': rec.get('promo', ''),
                'TAG': rec.get('tag', '')
            })
    
    print(f"\n✓ Exported {len(records)} records to: {output_path}")


def calculate_store_adjustment(store_rankings: Dict[str, int], 
                               subject_rankings: Dict[str, int],
                               adjustment_factors: Dict[str, float]) -> float:
    """
    Calculate total adjustment percentage for a competitor store.
    
    Formula: Sum of [(Competitor_Rank - Subject_Rank) * Weight] + Additional Factors
    
    Weights:
    - Location: 1.00%
    - Age: 1.00%
    - Accessibility: 0.50%
    - VPD: 0.50%
    - Visibility & Signage: 0.50%
    - Brand: 1.00%
    - Quality: 1.00%
    - Size: 1.00%
    
    Args:
        store_rankings: Competitor's rankings
        subject_rankings: Subject store's rankings
        adjustment_factors: Additional factors (Captive Market, Loss to Lease, CC Adj)
    
    Returns:
        Total adjustment percentage as decimal (e.g., 0.08 for 8%)
    """
    weights = {
        'Location': 0.01,
        'Age': 0.01,
        'Accessibility': 0.005,
        'VPD': 0.005,
        'Visibility & Signage': 0.005,
        'Brand': 0.01,
        'Quality': 0.01,
        'Size': 0.01
    }
    
    total_adj = 0.0
    
    for category, weight in weights.items():
        comp_rank = store_rankings.get(category, 5)
        subj_rank = subject_rankings.get(category, 5)
        delta = (comp_rank - subj_rank) * weight
        total_adj += delta
    
    # Add additional factors
    for factor_value in adjustment_factors.values():
        total_adj += factor_value
    
    return total_adj


def generate_csv2_report(records: List[Dict[str, Any]], 
                        selected_stores: List[Dict[str, Any]],
                        rankings: Dict[int, Dict[str, int]],
                        adjustment_factors: Dict[str, float],
                        output_path: str):
    """
    Generate CSV_2: Grouped averages report with adjusted pricing.
    
    Groups by (size, tag), shows each competitor on separate rows, plus aggregate averages.
    Includes monthly averages and T-12, T-6, T-3, T-1 averages for 3 price types.
    
    Args:
        records: All rate records
        selected_stores: List of selected stores
        rankings: Store rankings dict
        adjustment_factors: Additional adjustment factors
        output_path: Path for CSV_2 output
    """
    from collections import defaultdict
    from dateutil.relativedelta import relativedelta
    
    print("\n" + "=" * 80)
    print("GENERATING CSV_2: GROUPED AVERAGES REPORT")
    print("=" * 80)
    
    # Get subject store (first in list)
    subject_store_id = selected_stores[0].get('storeid')
    subject_rankings = rankings.get(subject_store_id, {})
    
    # Calculate adjustment percentages for each store
    store_adjustments = {}
    for store in selected_stores:
        store_id = store.get('storeid')
        if store_id == subject_store_id:
            store_adjustments[store_id] = 0.0  # Subject has no adjustment
        else:
            store_rankings = rankings.get(store_id, {})
            adjustment = calculate_store_adjustment(store_rankings, subject_rankings, adjustment_factors)
            store_adjustments[store_id] = adjustment
    
    # Find most recent date in dataset
    all_dates = [datetime.strptime(r['date'], '%Y-%m-%d') for r in records if r.get('date')]
    if not all_dates:
        print("No date information in records. Cannot generate CSV_2.")
        return
    
    most_recent = max(all_dates)
    
    # Define T-period start dates (first of the month)
    t12_start = (most_recent.replace(day=1) - relativedelta(months=11))  # 12 months including current
    t6_start = (most_recent.replace(day=1) - relativedelta(months=5))
    t3_start = (most_recent.replace(day=1) - relativedelta(months=2))
    t1_start = most_recent.replace(day=1)
    
    print(f"  Most recent data: {most_recent.strftime('%Y-%m-%d')}")
    print(f"  T-12 period: {t12_start.strftime('%Y-%m-%d')} to {most_recent.strftime('%Y-%m-%d')}")
    print(f"  T-6 period: {t6_start.strftime('%Y-%m-%d')} to {most_recent.strftime('%Y-%m-%d')}")
    print(f"  T-3 period: {t3_start.strftime('%Y-%m-%d')} to {most_recent.strftime('%Y-%m-%d')}")
    print(f"  T-1 period: {t1_start.strftime('%Y-%m-%d')} to {most_recent.strftime('%Y-%m-%d')}")
    
    # Group records by (size, tag, store_id)
    grouped = defaultdict(lambda: defaultdict(list))
    
    # Define allowed unit sizes for CSV_2
    allowed_sizes = {'5x5', '5x10', '10x5', '10x10', '10x15', '10x20', '10x25', '10x30'}
    
    for rec in records:
        size = rec.get('size', '').strip()
        tag = rec.get('tag', '')
        store_id = rec.get('store_id')
        rec_date_str = rec.get('date')
        
        if not rec_date_str or not size or not tag:
            continue
        
        # Normalize size for comparison (remove spaces, convert to lowercase)
        normalized_size = size.replace(' ', '').replace("'", '').lower()
        
        # Only include allowed sizes
        if normalized_size not in allowed_sizes:
            continue
        
        try:
            rec_date = datetime.strptime(rec_date_str, '%Y-%m-%d')
        except:
            continue
        
        # Only include records within T-12 period
        if rec_date < t12_start:
            continue
        
        group_key = (size, tag)
        grouped[group_key][store_id].append({
            'date': rec_date,
            'walk_in_price': rec.get('walk_in_price'),
            'online_price': rec.get('online_price'),
            'store_name': rec.get('store_name', ''),
            'store_id': store_id
        })
    
    # Sort groups by size
    def parse_size(size_str):
        """Extract numeric value for sorting (e.g., '5x10' -> 50)"""
        parts = size_str.lower().replace('x', ' ').replace("'", '').split()
        try:
            if len(parts) >= 2:
                return float(parts[0]) * float(parts[1])
            return float(parts[0]) if parts else 0
        except:
            return 0
    
    sorted_groups = sorted(grouped.keys(), key=lambda x: parse_size(x[0]))
    
    # Prepare CSV output
    fieldnames = [
        'Unit Size', 'Tag', 'Competitor',
        'Jan In Store', 'Feb In Store', 'Mar In Store', 'Apr In Store',
        'May In Store', 'Jun In Store', 'Jul In Store', 'Aug In Store',
        'Sep In Store', 'Oct In Store', 'Nov In Store', 'Dec In Store',
        'Jan Asking UnAdj', 'Feb Asking UnAdj', 'Mar Asking UnAdj', 'Apr Asking UnAdj',
        'May Asking UnAdj', 'Jun Asking UnAdj', 'Jul Asking UnAdj', 'Aug Asking UnAdj',
        'Sep Asking UnAdj', 'Oct Asking UnAdj', 'Nov Asking UnAdj', 'Dec Asking UnAdj',
        'Jan Asking Adj', 'Feb Asking Adj', 'Mar Asking Adj', 'Apr Asking Adj',
        'May Asking Adj', 'Jun Asking Adj', 'Jul Asking Adj', 'Aug Asking Adj',
        'Sep Asking Adj', 'Oct Asking Adj', 'Nov Asking Adj', 'Dec Asking Adj',
        'T-12 In Store', 'T-6 In Store', 'T-3 In Store', 'T-1 In Store',
        'T-12 Asking UnAdj', 'T-6 Asking UnAdj', 'T-3 Asking UnAdj', 'T-1 Asking UnAdj',
        'T-12 Asking Adj', 'T-6 Asking Adj', 'T-3 Asking Adj', 'T-1 Asking Adj',
        'Adjustment %'
    ]
    
    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        
        # Define calc_t_averages helper function
        def calc_t_averages(records, start_date, adjustment_pct=0.0):
            """Calculate T-period averages for walk-in, online, and adjusted prices."""
            walk_in_prices = [r['walk_in_price'] for r in records 
                            if r['date'] >= start_date and r['walk_in_price']]
            online_prices = [r['online_price'] for r in records 
                          if r['date'] >= start_date and r['online_price']]
            
            walk_in_avg = sum(walk_in_prices) / len(walk_in_prices) if walk_in_prices else None
            online_avg = sum(online_prices) / len(online_prices) if online_prices else None
            online_adj_avg = online_avg * (1 + adjustment_pct) if online_avg else None
            
            return walk_in_avg, online_avg, online_adj_avg
        
        for group_key in sorted_groups:
            size, tag = group_key
            stores_in_group = grouped[group_key]
            
            # Write each store's row
            for store_id, rate_records in stores_in_group.items():
                store_name = rate_records[0]['store_name'] if rate_records else 'Unknown'
                adjustment_pct = store_adjustments.get(store_id, 0.0)
                
                # Calculate monthly averages
                monthly_walk_in = {m: [] for m in range(1, 13)}
                monthly_online = {m: [] for m in range(1, 13)}
                
                for r in rate_records:
                    month = r['date'].month
                    if r['walk_in_price']:
                        monthly_walk_in[month].append(r['walk_in_price'])
                    if r['online_price']:
                        monthly_online[month].append(r['online_price'])
                
                month_names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                              'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                
                row = {
                    'Unit Size': size,
                    'Tag': tag,
                    'Competitor': store_name,
                    'Adjustment %': f"{adjustment_pct*100:.2f}%"
                }
                
                for i, month_name in enumerate(month_names, 1):
                    walk_in_avg = sum(monthly_walk_in[i]) / len(monthly_walk_in[i]) if monthly_walk_in[i] else None
                    online_avg = sum(monthly_online[i]) / len(monthly_online[i]) if monthly_online[i] else None
                    online_adj_avg = online_avg * (1 + adjustment_pct) if online_avg else None
                    
                    row[f'{month_name} In Store'] = f"${walk_in_avg:.2f}" if walk_in_avg else ''
                    row[f'{month_name} Asking UnAdj'] = f"${online_avg:.2f}" if online_avg else ''
                    row[f'{month_name} Asking Adj'] = f"${online_adj_avg:.2f}" if online_adj_avg else ''
                
                # Calculate T-period averages
                t12_walk, t12_online, t12_adj = calc_t_averages(rate_records, t12_start, adjustment_pct)
                t6_walk, t6_online, t6_adj = calc_t_averages(rate_records, t6_start, adjustment_pct)
                t3_walk, t3_online, t3_adj = calc_t_averages(rate_records, t3_start, adjustment_pct)
                t1_walk, t1_online, t1_adj = calc_t_averages(rate_records, t1_start, adjustment_pct)
                
                row.update({
                    'T-12 In Store': f"${t12_walk:.2f}" if t12_walk else '',
                    'T-6 In Store': f"${t6_walk:.2f}" if t6_walk else '',
                    'T-3 In Store': f"${t3_walk:.2f}" if t3_walk else '',
                    'T-1 In Store': f"${t1_walk:.2f}" if t1_walk else '',
                    'T-12 Asking UnAdj': f"${t12_online:.2f}" if t12_online else '',
                    'T-6 Asking UnAdj': f"${t6_online:.2f}" if t6_online else '',
                    'T-3 Asking UnAdj': f"${t3_online:.2f}" if t3_online else '',
                    'T-1 Asking UnAdj': f"${t1_online:.2f}" if t1_online else '',
                    'T-12 Asking Adj': f"${t12_adj:.2f}" if t12_adj else '',
                    'T-6 Asking Adj': f"${t6_adj:.2f}" if t6_adj else '',
                    'T-3 Asking Adj': f"${t3_adj:.2f}" if t3_adj else '',
                    'T-1 Asking Adj': f"${t1_adj:.2f}" if t1_adj else ''
                })
                
                writer.writerow(row)
            
            # Calculate and write aggregate average row
            all_records_in_group = []
            for store_records in stores_in_group.values():
                all_records_in_group.extend(store_records)
            
            agg_row = {
                'Unit Size': size,
                'Tag': tag,
                'Competitor': 'AVERAGE',
                'Adjustment %': ''
            }
            
            # Aggregate monthly averages
            for i, month_name in enumerate(month_names, 1):
                month_walk_in = [r['walk_in_price'] for r in all_records_in_group 
                                if r['date'].month == i and r['walk_in_price']]
                month_online = [r['online_price'] for r in all_records_in_group 
                               if r['date'].month == i and r['online_price']]
                
                walk_avg = sum(month_walk_in) / len(month_walk_in) if month_walk_in else None
                online_avg = sum(month_online) / len(month_online) if month_online else None
                
                agg_row[f'{month_name} In Store'] = f"${walk_avg:.2f}" if walk_avg else ''
                agg_row[f'{month_name} Asking UnAdj'] = f"${online_avg:.2f}" if online_avg else ''
                agg_row[f'{month_name} Asking Adj'] = ''  # No aggregate adjusted (adjustments vary by store)
            
            # Aggregate T-period averages
            agg_t12_walk, agg_t12_online, _ = calc_t_averages(all_records_in_group, t12_start)
            agg_t6_walk, agg_t6_online, _ = calc_t_averages(all_records_in_group, t6_start)
            agg_t3_walk, agg_t3_online, _ = calc_t_averages(all_records_in_group, t3_start)
            agg_t1_walk, agg_t1_online, _ = calc_t_averages(all_records_in_group, t1_start)
            
            agg_row.update({
                'T-12 In Store': f"${agg_t12_walk:.2f}" if agg_t12_walk else '',
                'T-6 In Store': f"${agg_t6_walk:.2f}" if agg_t6_walk else '',
                'T-3 In Store': f"${agg_t3_walk:.2f}" if agg_t3_walk else '',
                'T-1 In Store': f"${agg_t1_walk:.2f}" if agg_t1_walk else '',
                'T-12 Asking UnAdj': f"${agg_t12_online:.2f}" if agg_t12_online else '',
                'T-6 Asking UnAdj': f"${agg_t6_online:.2f}" if agg_t6_online else '',
                'T-3 Asking UnAdj': f"${agg_t3_online:.2f}" if agg_t3_online else '',
                'T-1 Asking UnAdj': f"${agg_t1_online:.2f}" if agg_t1_online else '',
                'T-12 Asking Adj': '',  # No aggregate adjusted (since adjustments vary by store)
                'T-6 Asking Adj': '',
                'T-3 Asking Adj': '',
                'T-1 Asking Adj': ''
            })
            
            writer.writerow(agg_row)
            
            # Blank line between groups
            writer.writerow({k: '' for k in fieldnames})
    
    print(f"✓ CSV_2 exported to: {output_path}")


def format_competitor_report(subject_store: Dict[str, Any], competitors: List[Dict[str, Any]]) -> str:
    """
    Format a competitor analysis report (store info only, no rates).
    
    Args:
        subject_store: Subject store information
        competitors: List of competitor store information
    
    Returns:
        Formatted report string
    """
    report = []
    report.append("=" * 80)
    report.append("COMPETITOR ANALYSIS REPORT")
    report.append("=" * 80)
    report.append("")
    
    # Subject Store Info
    report.append("SUBJECT STORE:")
    report.append(f"  Name: {subject_store.get('storename', 'N/A')}")
    report.append(f"  Address: {subject_store.get('address', 'N/A')}")
    report.append(f"  City, State ZIP: {subject_store.get('city', '')}, {subject_store.get('state', '')} {subject_store.get('zip', '')}")
    report.append(f"  Store ID: {subject_store.get('storeid', 'N/A')}")
    report.append(f"  Master ID: {subject_store.get('masterid', 'N/A')}")
    report.append(f"  Phone: {subject_store.get('phone', 'N/A')}")
    report.append(f"  Lat/Long: {subject_store.get('latitude', 'N/A')}, {subject_store.get('longitude', 'N/A')}")
    report.append(f"  Status: {subject_store.get('storestatus', 'N/A')} (1=Rates Available, 2=Website Only, 3=No Data)")
    
    report.append("")
    report.append("=" * 80)
    report.append(f"COMPETITORS ({len(competitors)} found):")
    report.append("=" * 80)
    report.append("")
    
    if not competitors:
        report.append("No competitors found within the specified radius.")
    else:
        # Competitor info
        for idx, comp in enumerate(competitors, 1):
            report.append(f"{idx}. {comp.get('storename', 'N/A')}")
            report.append(f"   Address: {comp.get('address', 'N/A')}")
            report.append(f"   City, State ZIP: {comp.get('city', '')}, {comp.get('state', '')} {comp.get('zip', '')}")
            report.append(f"   Distance: {comp.get('distance', 'N/A')} miles")
            report.append(f"   Store ID: {comp.get('storeid', 'N/A')} | Master ID: {comp.get('masterid', 'N/A')}")
            report.append(f"   Phone: {comp.get('phone', 'N/A')}")
            report.append(f"   Status: {comp.get('storestatus', 'N/A')} (1=Rates Available, 2=Website Only, 3=No Data)")
            report.append("")
    
    return "\n".join(report)


def get_user_input() -> Dict[str, Any]:
    """Interactive prompts to gather search criteria from user."""
    print("\n" + "=" * 80)
    print("COMPETITOR RATE ANALYSIS - INTERACTIVE MODE")
    print("=" * 80)
    print("\nPlease provide search criteria to find your subject store:")
    print("(Press Enter to skip optional fields)\n")
    
    # Get search parameters
    street_address = input("Street Address (e.g., 123 Main St): ").strip()
    country = input("Country [United States]: ").strip() or "United States"
    state = input("State (e.g., NY, CA): ").strip()
    city = input("City: ").strip()
    zip_code = input("ZIP Code: ").strip()
    store_name = input("Store Name (optional): ").strip()
    company_name = input("Company Name (optional): ").strip()
    
    print("\n" + "-" * 80)
    radius_input = input("Search radius in miles [5.0]: ").strip()
    try:
        radius = float(radius_input) if radius_input else 5.0
    except ValueError:
        print("Invalid radius, using default 5.0 miles")
        radius = 5.0
    
    output_file = input("Save report to file (leave blank for console output): ").strip()
    
    return {
        'street_address': street_address,
        'country': country,
        'state': state,
        'city': city,
        'zip': zip_code,
        'store_name': store_name,
        'company_name': company_name,
        'radius': radius,
        'output': output_file if output_file else None
    }


def main(argv=None):
    setup_logging()
    
    parser = argparse.ArgumentParser(description='RCA Competitor Analysis Tool')
    parser.add_argument('--city', type=str, help='City name (if not provided, will prompt)')
    parser.add_argument('--state', type=str, help='State code (e.g., NY)')
    parser.add_argument('--zip', type=str, help='ZIP code')
    parser.add_argument('--country', type=str, default='United States', help='Country name (default: United States)')
    parser.add_argument('--radius', type=float, help='Search radius in miles (default: 5.0)')
    parser.add_argument('--store-name', type=str, help='Filter by store name')
    parser.add_argument('--company-name', type=str, help='Filter by company name')
    parser.add_argument('--output', type=str, help='Output file path (optional, prints to console if not specified)')
    parser.add_argument('--interactive', action='store_true', default=True, help='Interactive mode (default)')
    parser.add_argument('--verbose', action='store_true', help='Enable debug logging')
    
    args = parser.parse_args(argv)
    
    if args.verbose:
        setup_logging(verbose=True)
    
    # If no city/state provided via CLI, use interactive mode
    if not args.city or not args.state:
        user_input = get_user_input()
        street_address = user_input['street_address']
        country = user_input['country']
        state = user_input['state']
        city = user_input['city']
        zip_code = user_input['zip']
        store_name = user_input['store_name']
        company_name = user_input['company_name']
        radius = user_input['radius']
        output_file = user_input['output']
    else:
        # Use CLI arguments
        street_address = ""
        country = args.country
        state = args.state
        city = args.city
        zip_code = args.zip or ""
        store_name = args.store_name or ""
        company_name = args.company_name or ""
        radius = args.radius if args.radius else 5.0
        output_file = args.output
    
    # Get credentials from environment
    api_base_url = os.getenv('STORTRACK_BASEURL', 'https://api.stortrack.com/')
    api_user = os.getenv('STORTRACK_USERNAME', 'cpj@williamwarren.com')
    api_pass = os.getenv('STORTRACK_PASSWORD', 'vhP6ZXrJ')
    
    db_server = os.getenv('DB_SERVER', '13.57.123.119')
    db_user = os.getenv('DB_USERNAME', 'williamwarren')
    db_pass = os.getenv('DB_PASSWORD', 'storquest01')
    
    # Initialize API client and DB manager
    api = StorTrackAPIClient(base_url=api_base_url, username=api_user, password=api_pass)
    db = RatesDBManager(server=db_server, username=db_user, password=db_pass)
    
    # Build search summary
    search_parts = []
    if street_address:
        search_parts.append(street_address)
    if city:
        search_parts.append(city)
    if state:
        search_parts.append(state)
    if zip_code:
        search_parts.append(zip_code)
    if store_name:
        search_parts.append(f"Store: {store_name}")
    if company_name:
        search_parts.append(f"Company: {company_name}")
    
    search_summary = ", ".join(search_parts) if search_parts else "No criteria"
    print(f"\nSearching for: {search_summary}")
    logging.info(f"Searching for stores: {search_summary}")
    
    # Step 1: Find subject store by address
    stores = api.find_stores_by_address(
        country=country,
        state=state,
        city=city,
        zip_code=zip_code,
        store_name=store_name,
        company_name=company_name
    )
    
    if not stores:
        logging.error("No stores found matching the search criteria")
        return 1
    
    logging.info(f"Found {len(stores)} store(s) matching search criteria")
    
    # If multiple stores found, let user select
    if len(stores) > 1:
        print("\n" + "=" * 80)
        print("MULTIPLE STORES FOUND - Please select the subject store:")
        print("=" * 80)
        for idx, store in enumerate(stores, 1):
            print(f"\n{idx}. {store.get('storename', 'N/A')}")
            print(f"   Address: {store.get('address', 'N/A')}")
            print(f"   City: {store.get('city', 'N/A')}, {store.get('state', 'N/A')} {store.get('zip', 'N/A')}")
            print(f"   Store ID: {store.get('storeid', 'N/A')} | Status: {store.get('storestatus', 'N/A')}")
        
        while True:
            try:
                selection = input(f"\nSelect store number (1-{len(stores)}) [1]: ").strip()
                if not selection:
                    idx = 0
                    break
                idx = int(selection) - 1
                if 0 <= idx < len(stores):
                    break
                else:
                    print(f"Please enter a number between 1 and {len(stores)}")
            except ValueError:
                print("Invalid input. Please enter a number.")
        
        subject_store = stores[idx]
    else:
        subject_store = stores[0]
    
    subject_id = subject_store.get('storeid')
    
    print("\n" + "=" * 80)
    print(f"SUBJECT STORE SELECTED: {subject_store.get('storename')} (ID: {subject_id})")
    print("=" * 80)
    
    # Step 2: Find competitors within radius
    logging.info(f"Finding competitors within {radius} miles...")
    competitor_data = api.find_competitors(storeid=subject_id, coverage_zone=radius)
    
    if not competitor_data:
        logging.error("Failed to retrieve competitor data")
        return 1
    
    # Handle response format - API may return dict with 'competitorstores' or a list directly
    if isinstance(competitor_data, dict):
        # Expected format: {"storeid": ..., "competitorstores": [...]}
        competitors = competitor_data.get('competitorstores', [])
    elif isinstance(competitor_data, list):
        # Alternate format: API returns list directly
        # Each item may have competitorstores nested
        competitors = []
        for item in competitor_data:
            if isinstance(item, dict):
                # Check if this item has competitorstores
                nested_comps = item.get('competitorstores', [])
                if nested_comps:
                    competitors.extend(nested_comps)
                elif item.get('storeid') and item.get('storeid') != subject_id:
                    # This item itself might be a competitor
                    competitors.append(item)
    else:
        logging.error(f"Unexpected competitor data format: {type(competitor_data)}")
        competitors = []
    
    logging.info(f"Found {len(competitors)} competitor(s)")
    
    # Step 3: Display competitor report
    report = format_competitor_report(subject_store, competitors)
    print("\n" + report)
    
    # Step 4: Ask if user wants rate analysis
    print("\n" + "=" * 80)
    print("RATE ANALYSIS OPTIONS")
    print("=" * 80)
    print("\nWould you like to analyze historical rates for selected stores?")
    print("  [Y] Yes - Continue to store selection for rate analysis")
    print("  [N] No - Exit (report already displayed above)")
    
    proceed = input("\nContinue with rate analysis? [Y/N]: ").strip().upper()
    if proceed != 'Y':
        print("\nExiting. Competitor report displayed above.")
        return 0
    
    # Step 5: Let user select stores for rate analysis
    selected_stores = get_store_selection(subject_store, competitors)
    
    if not selected_stores:
        print("No stores selected. Exiting.")
        return 0
    
    # Step 5a: Collect store metadata (Year Built, SF, Distance)
    store_metadata = lookup_store_metadata(selected_stores, db_server, db_user, db_pass)
    
    # Step 5b: Collect rankings for all stores (subject + competitors)
    rankings = collect_store_rankings(selected_stores, store_metadata)
    
    # Step 5c: Collect additional adjustment factors
    adjustment_factors = collect_adjustment_factors()
    
    # Step 5d: Let user edit store names for CSV
    name_mapping = edit_store_names(selected_stores)
    
    # Step 6: Define trailing 12-month date range
    to_date = date.today()
    from_date = date(2024, 12, 1)  # Per user request: trailing 12 months starting Dec 1, 2024
    
    print(f"\n📅 Analysis Period: {from_date.strftime('%Y-%m-%d')} to {to_date.strftime('%Y-%m-%d')}")
    
    # Step 7: Query database for existing rate data (FREE)
    selected_ids = [s.get('storeid') for s in selected_stores]
    print(f"\n🔍 Querying database for {len(selected_ids)} store(s)...")
    
    rates_by_store, dates_by_store = db.get_trailing_12_month_rates(selected_ids, from_date, to_date)
    
    total_db_records = sum(len(rates) for rates in rates_by_store.values())
    print(f"   Found {total_db_records} rate records in database")
    
    # Step 8: Analyze date gaps
    gaps_by_store = analyze_date_gaps(dates_by_store, from_date, to_date)
    
    # Step 9: Display gap analysis and get API decision
    api_store_ids, api_days = display_gap_analysis(selected_stores, gaps_by_store, from_date, to_date)
    
    # Step 10: Fetch missing data from API if user approved
    api_records = []
    
    # Build store info map for distance (used by parse_api_rate_data)
    api_store_info = {}
    for store in selected_stores:
        sid = store.get('storeid')
        api_store_info[sid] = {
            'store_id': sid,
            'store_name': store.get('storename', ''),
            'address': store.get('address', ''),
            'city': store.get('city', ''),
            'state': store.get('state', ''),
            'zip': store.get('zip', ''),
            'distance': store.get('distance', '')
        }
    
    if api_store_ids and api_days > 0:
        print(f"\n🌐 Fetching historical data from API for {len(api_store_ids)} store(s)...")
        
        for store_id in api_store_ids:
            # Get missing dates for this store
            missing_dates = gaps_by_store.get(store_id, [])
            if not missing_dates:
                continue
            
            # Group consecutive dates into ranges to minimize API calls
            ranges = []
            start = missing_dates[0]
            end = missing_dates[0]
            for d in missing_dates[1:]:
                if (d - end).days == 1:
                    end = d
                else:
                    ranges.append((start, end))
                    start = end = d
            ranges.append((start, end))
            
            # Fetch each range
            for range_start, range_end in ranges:
                print(f"   Fetching Store {store_id}: {range_start} to {range_end}...")
                api_data = api.fetch_historical_data(
                    store_id,
                    range_start.strftime('%Y-%m-%d'),
                    range_end.strftime('%Y-%m-%d')
                )
                
                if api_data:
                    parsed_records = parse_api_rate_data(api_data, api_store_info)
                    api_records.extend(parsed_records)
                    print(f"      Retrieved {len(parsed_records)} rate records")
        
        print(f"\n✓ Total API records fetched: {len(api_records)}")
    
    # Step 11: Combine DB and API data
    # Convert DB records to standard format
    db_records = convert_db_rates_to_records(rates_by_store, api_store_info)
    
    # Combine all records
    all_records = db_records + api_records
    
    if not all_records:
        print("\n⚠️  No rate data found for selected stores.")
        return 1
    
    print(f"\n📊 Total records before filtering: {len(all_records)}")
    print(f"   - From Database: {len(db_records)}")
    print(f"   - From API: {len(api_records)}")
    
    # Step 12: Filter to only unittype = "Unit"
    all_records = filter_unit_type(all_records, "Unit")
    
    if not all_records:
        print("\n⚠️  No 'Unit' type records found after filtering.")
        return 1
    
    # Step 13: Apply custom store names
    all_records = apply_name_mapping(all_records, name_mapping)
    
    # Step 14: Let user assign feature codes
    feature_mapping = edit_feature_codes(all_records)
    
    # Step 15: Apply feature codes
    all_records = apply_feature_mapping(all_records, feature_mapping)
    
    print(f"\n📊 Final records to export: {len(all_records)}")
    
    # Step 16: Determine output paths and export both CSVs
    if not output_file:
        # Generate default filename
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        city_slug = city.replace(' ', '_').lower() if city else 'unknown'
        output_file_csv1 = f"RCA_{city_slug}_{timestamp}_data.csv"
        output_file_csv2 = f"RCA_{city_slug}_{timestamp}_summary.csv"
    else:
        # Use provided filename as base
        base_name = output_file.replace('.csv', '')
        output_file_csv1 = f"{base_name}_data.csv"
        output_file_csv2 = f"{base_name}_summary.csv"
    
    # Export CSV_1: Full data dump
    print("\n" + "=" * 80)
    print("EXPORTING CSV_1: FULL DATA DUMP")
    print("=" * 80)
    export_to_csv(all_records, output_file_csv1, store_metadata)
    
    # Export CSV_2: Grouped averages with adjustments
    generate_csv2_report(all_records, selected_stores, rankings, adjustment_factors, output_file_csv2)
    
    print("\n" + "=" * 80)
    print("ANALYSIS COMPLETE")
    print("=" * 80)
    print(f"Subject Store: {subject_store.get('storename')}")
    print(f"Competitors Analyzed: {len(selected_stores) - 1 if subject_store in selected_stores else len(selected_stores)}")
    print(f"Date Range: {from_date} to {to_date}")
    print(f"Total Rate Records: {len(all_records)}")
    print(f"\nOutput Files:")
    print(f"  CSV_1 (Data Dump): {output_file_csv1}")
    print(f"  CSV_2 (Summary): {output_file_csv2}")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
