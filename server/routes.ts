import type { Express } from "express";
import { createServer, type Server } from "http";

const STORTRACK_BASEURL = process.env.STORTRACK_BASEURL || "";
const STORTRACK_USERNAME = process.env.STORTRACK_USERNAME || "";
const STORTRACK_PASSWORD = process.env.STORTRACK_PASSWORD || "";
const MCP_BASE_URL = "https://mcp.wwgmcpserver.com";
const MCP_API_KEY = process.env.WWG_MCP_API_KEY || "";

// AWS S3 configuration for rate data export
const AWS_S3_BUCKET = process.env.AWS_S3_BUCKET || "get-off-replit-we-need-the-rca-data";
const AWS_S3_REGION = process.env.AWS_S3_REGION || "us-west-1";
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || "";
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || "";

// Error types for user-friendly messages
interface FormattedError {
  message: string;
  isTransient: boolean;
  suggestedAction: string;
}

function formatMCPError(error: Error): FormattedError {
  const msg = error.message.toLowerCase();

  if (msg.includes("odbc") || msg.includes("driver")) {
    return {
      message: "Database connection issue on MCP server",
      isTransient: true,
      suggestedAction:
        "The MCP database server is experiencing connection issues. Please try again in a few minutes.",
    };
  }

  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      message: "Request timed out",
      isTransient: true,
      suggestedAction:
        "The server is responding slowly. Please try again.",
    };
  }

  if (
    msg.includes("authentication") ||
    msg.includes("401") ||
    msg.includes("unauthorized")
  ) {
    return {
      message: "Authentication failed",
      isTransient: false,
      suggestedAction:
        "API credentials may be invalid. Please contact your administrator.",
    };
  }

  if (msg.includes("econnrefused") || msg.includes("connection refused")) {
    return {
      message: "Cannot connect to MCP server",
      isTransient: true,
      suggestedAction:
        "The MCP server may be temporarily unavailable. Please try again later.",
    };
  }

  if (msg.includes("data source name not found")) {
    return {
      message: "Database configuration error on MCP server",
      isTransient: true,
      suggestedAction:
        "The MCP server's database configuration has an issue. This is a server-side problem - please try again later or contact support.",
    };
  }

  return {
    message: error.message,
    isTransient: false,
    suggestedAction: "An unexpected error occurred. Please try again or contact support.",
  };
}

// Retry wrapper with exponential backoff for MCP operations
async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 1000,
  operationName = "MCP operation"
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errMsg = lastError.message.toLowerCase();

      // Check if error is retryable
      const isRetryable =
        errMsg.includes("odbc") ||
        errMsg.includes("timeout") ||
        errMsg.includes("connection") ||
        errMsg.includes("econnrefused") ||
        errMsg.includes("driver") ||
        errMsg.includes("data source name");

      if (!isRetryable || attempt === maxRetries - 1) {
        throw lastError;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      console.warn(
        `${operationName} failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delay}ms:`,
        lastError.message
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

let cachedToken: string | null = null;
let tokenExpiry: number = 0;

async function getAuthToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const authUrl = `${STORTRACK_BASEURL.replace(/\/$/, "")}/authtoken`;

  try {
    const response = await fetch(authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "password",
        username: STORTRACK_USERNAME,
        password: STORTRACK_PASSWORD,
      }),
    });

    if (response.ok) {
      const data = await response.json();
      const token = data.access_token || data.token;
      if (token) {
        cachedToken = `Bearer ${token}`;
        tokenExpiry = Date.now() + 55 * 60 * 1000;
        return cachedToken;
      }
    }
    console.error(
      "Auth token fetch failed:",
      response.status,
      await response.text(),
    );
  } catch (error) {
    console.error("Auth token exception:", error);
  }
  return null;
}

async function findStoresByAddress(params: {
  country?: string;
  state?: string;
  city?: string;
  zip?: string;
  storename?: string;
  companyname?: string;
}) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Failed to authenticate with StorTrack API");
  }

  const url = `${STORTRACK_BASEURL.replace(/\/$/, "")}/storesbyaddress`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      authorization: token,
    },
    body: JSON.stringify({
      country: params.country || "United States",
      state: params.state || "",
      city: params.city || "",
      zip: params.zip || "",
      storename: params.storename || "",
      companyname: params.companyname || "",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Find stores failed:", response.status, errorText);
    throw new Error(`StorTrack API error: ${response.status}`);
  }

  const result = await response.json();
  return result.stores || [];
}

async function findCompetitors(params: {
  storeid?: number;
  masterid?: number;
  coveragezone?: number;
}) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Failed to authenticate with StorTrack API");
  }

  const url = `${STORTRACK_BASEURL.replace(/\/$/, "")}/findcompetitors`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      authorization: token,
    },
    body: JSON.stringify({
      storeid: params.storeid ? [params.storeid] : [],
      masterid: params.masterid ? [params.masterid] : [],
      coveragezone: params.coveragezone || 5.0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Find competitors failed:", response.status, errorText);
    throw new Error(`StorTrack API error: ${response.status}`);
  }

  return await response.json();
}

async function fetchHistoricalData(
  params: {
    storeid: number;
    from: string;
    to: string;
  },
  maxRetries = 3,
) {
  const token = await getAuthToken();
  if (!token) {
    throw new Error("Failed to authenticate with StorTrack API");
  }

  const url = `${STORTRACK_BASEURL.replace(/\/$/, "")}/historicaldata`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          authorization: token,
        },
        body: JSON.stringify({
          storeid: params.storeid,
          masterid: 0,
          from: params.from,
          to: params.to,
          requestyear: 0,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        return Array.isArray(result) ? result : [result];
      }

      if (response.status === 429) {
        console.warn(`Rate limited on attempt ${attempt + 1}, waiting...`);
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      }

      if ([500, 503, 404].includes(response.status)) {
        console.warn(`Got ${response.status} on attempt ${attempt + 1}`);
        if (attempt < maxRetries - 1) {
          await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
          continue;
        }
      }

      const errorText = await response.text();
      console.error("Historical data failed:", response.status, errorText);
      throw new Error(`StorTrack API error: ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }

  throw new Error("Max retries exceeded");
}

async function universalQuery(database: string, sqlQuery: string) {
  return withRetry(
    async () => {
      const url = `${MCP_BASE_URL}/query/universal`;

      const body = {
        database,
        query: sqlQuery,
      };

      console.log(`MCP Universal Query: ${url}`, JSON.stringify(body));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "X-API-Key": MCP_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`MCP API Error: ${response.status} - ${errorText}`);
        throw new Error(`MCP API error: ${response.status} - ${errorText}`);
      }

      const jsonResponse = await response.json();
      console.log(`MCP Universal Query response keys:`, Object.keys(jsonResponse));

      if (jsonResponse.results && Array.isArray(jsonResponse.results)) {
        console.log(`MCP response has ${jsonResponse.results.length} results`);
        return jsonResponse.results;
      }

      if (Array.isArray(jsonResponse)) {
        return jsonResponse;
      } else if (jsonResponse.data && Array.isArray(jsonResponse.data)) {
        return jsonResponse.data;
      }

      return jsonResponse;
    },
    3,
    1000,
    `MCP query (${database})`
  );
}

async function mcpRequest(endpoint: string, params?: Record<string, string>) {
  const url = new URL(`${MCP_BASE_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, value);
      }
    });
  }

  console.log(`MCP Request: ${url.toString()}`);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-API-Key": MCP_API_KEY,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`MCP API Error: ${response.status} - ${errorText}`);
    throw new Error(`MCP API error: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

function parsePythonDict(dictStr: string): Record<string, any> | null {
  if (!dictStr || typeof dictStr !== "string") return null;

  try {
    return JSON.parse(dictStr);
  } catch {
    try {
      const jsonString = dictStr
        .replace(/'/g, '"')
        .replace(/None/g, "null")
        .replace(/True/g, "true")
        .replace(/False/g, "false");
      return JSON.parse(jsonString);
    } catch {
      return null;
    }
  }
}

function fuzzyMatchScore(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  if (s1 === s2) return 1;

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1;

  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  const costs: number[] = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }

  return (longer.length - costs[s2.length]) / longer.length;
}

function normalizeAddress(addr: string): string {
  return (addr || "")
    .toLowerCase()
    .trim()
    .replace(/[.,#]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\bavenue\b/g, "ave")
    .replace(/\bstreet\b/g, "st")
    .replace(/\bdrive\b/g, "dr")
    .replace(/\bboulevard\b/g, "blvd")
    .replace(/\broad\b/g, "rd")
    .replace(/\blane\b/g, "ln")
    .replace(/\bcourt\b/g, "ct")
    .replace(/\bnorth\b/g, "n")
    .replace(/\bsouth\b/g, "s")
    .replace(/\beast\b/g, "e")
    .replace(/\bwest\b/g, "w")
    .replace(/\bnortheast\b/g, "ne")
    .replace(/\bnorthwest\b/g, "nw")
    .replace(/\bsoutheast\b/g, "se")
    .replace(/\bsouthwest\b/g, "sw");
}

async function getSalesforceByName(storeName: string) {
  console.log("Querying Salesforce_rawData by name:", storeName);

  const sql = `
    SELECT TOP 5 Name, Year_Built__c, Net_RSF__c, ShippingAddress
    FROM dbo.Salesforce_rawData
    WHERE Name LIKE '%${storeName.replace(/'/g, "''")}%'
      AND (Year_Built__c IS NOT NULL OR Net_RSF__c IS NOT NULL)
  `;

  const results = await universalQuery("Sites", sql);

  if (!results || !Array.isArray(results) || results.length === 0) {
    console.log("No results from Salesforce_rawData by name");
    return [];
  }

  console.log(`Found ${results.length} records matching name`);
  return results.map((record: any) => ({
    Year_Built__c: record.Year_Built__c,
    Net_RSF__c: record.Net_RSF__c,
    Name: record.Name,
    ShippingAddress: record.ShippingAddress,
  }));
}

async function getSalesforceMetadataByAddress(params: {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  storeName?: string;
}) {
  console.log("Querying Salesforce_rawData for address:", params);

  const sql = `
    SELECT Name, Year_Built__c, Net_RSF__c, ShippingAddress
    FROM dbo.Salesforce_rawData
    WHERE (Net_RSF__c IS NOT NULL OR Year_Built__c IS NOT NULL)
      AND Name IS NOT NULL
  `;
  const results = await universalQuery("Sites", sql);

  if (!results || !Array.isArray(results) || results.length === 0) {
    console.log("No results from Salesforce_rawData");
    return [];
  }

  console.log(`Retrieved ${results.length} records from Salesforce_rawData`);

  const targetStreet = normalizeAddress(params.street);
  const targetStoreName = (params.storeName || "").toLowerCase().trim();

  const scoredMatches: Array<{
    Name: string;
    Year_Built__c: any;
    Net_RSF__c: any;
    ShippingAddress: any;
    nameScore: number;
    addressScore: number;
    combinedScore: number;
    parsedStoreName: string;
    parsedAddress: string;
  }> = [];

  for (const record of results) {
    const sfName = record.Name || "";
    const sfStoreBrand = sfName.includes(" - ")
      ? sfName.split(" - ")[0].trim()
      : sfName;

    let sfStreet = "";
    const shippingAddress = parsePythonDict(record.ShippingAddress);

    if (shippingAddress && shippingAddress.street) {
      sfStreet = shippingAddress.street;
    } else if (sfName.includes(" - ")) {
      const nameParts = sfName.split(" - ");
      if (nameParts.length >= 2) {
        const potentialAddress = nameParts[1].trim();
        if (
          /\d+/.test(potentialAddress) ||
          /(st|ave|rd|blvd|dr|way|lane|court)/i.test(potentialAddress)
        ) {
          sfStreet = potentialAddress;
        }
      }
    }

    if (!sfStreet) continue;

    const nameScoreFull = fuzzyMatchScore(
      targetStoreName,
      sfName.toLowerCase(),
    );
    const nameScoreBrand = fuzzyMatchScore(
      targetStoreName,
      sfStoreBrand.toLowerCase(),
    );
    const nameScore = Math.max(nameScoreFull, nameScoreBrand);

    const normalizedSfStreet = normalizeAddress(sfStreet);
    const addressScore = fuzzyMatchScore(targetStreet, normalizedSfStreet);

    const combinedScore = nameScore * 0.4 + addressScore * 0.6;

    if (combinedScore > 0.3 || addressScore > 0.5) {
      scoredMatches.push({
        Name: sfName,
        Year_Built__c: record.Year_Built__c,
        Net_RSF__c: record.Net_RSF__c,
        ShippingAddress: record.ShippingAddress,
        nameScore,
        addressScore,
        combinedScore,
        parsedStoreName: sfStoreBrand,
        parsedAddress: sfStreet,
      });
    }
  }

  // Sort by address score first (100% address match should always be first),
  // then by combined score for ties
  scoredMatches.sort((a, b) => {
    // If one has 100% address match and the other doesn't, prioritize the 100% match
    const aHasPerfectAddress = a.addressScore >= 0.99;
    const bHasPerfectAddress = b.addressScore >= 0.99;

    if (aHasPerfectAddress && !bHasPerfectAddress) return -1;
    if (bHasPerfectAddress && !aHasPerfectAddress) return 1;

    // If both have perfect address or neither does, sort by address score first
    if (a.addressScore !== b.addressScore) {
      return b.addressScore - a.addressScore;
    }

    // If address scores are equal, use combined score as tiebreaker
    return b.combinedScore - a.combinedScore;
  });

  console.log(`Found ${scoredMatches.length} matching records for address`);

  return scoredMatches.slice(0, 10);
}

async function healthCheck() {
  const response = await fetch(`${MCP_BASE_URL}/health`);
  return { healthy: response.ok, status: response.status };
}

async function getDatabases() {
  return await mcpRequest("/databases");
}

async function getSites(params?: { state?: string; city?: string }) {
  return await mcpRequest("/sites", params as Record<string, string>);
}

async function getStortrackData(
  endpoint: string,
  params?: Record<string, string>,
) {
  return await mcpRequest(`/stortrack${endpoint}`, params);
}

async function queryDatabase(
  database: string,
  table: string,
  filters?: Record<string, any>,
  limit?: number,
) {
  let sql = `SELECT TOP ${limit || 1000} * FROM dbo.${table}`;

  if (filters && Object.keys(filters).length > 0) {
    const whereClauses = Object.entries(filters)
      .map(([key, value]) => `${key} = '${value}'`)
      .join(" AND ");
    sql += ` WHERE ${whereClauses}`;
  }

  return await universalQuery(database, sql);
}

async function getAnalytics(type: string) {
  return await mcpRequest(`/analytics/${type}`);
}

async function getStorEdgeData(
  endpoint: string,
  params?: Record<string, string>,
) {
  return await mcpRequest(`/storedge/${endpoint}`, params);
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/stortrack", async (req, res) => {
    try {
      const { action, params } = req.body;
      console.log(`StorTrack API action: ${action}`, params);

      let result;

      switch (action) {
        case "findStoresByAddress":
          result = await findStoresByAddress(params);
          break;
        case "findCompetitors":
          result = await findCompetitors(params);
          break;
        case "fetchHistoricalData":
          result = await fetchHistoricalData(params);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      res.json({ success: true, data: result });
    } catch (error: unknown) {
      console.error("StorTrack API error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  app.post("/api/database", async (req, res) => {
    try {
      const { action, params } = req.body;
      console.log(`Database query action: ${action}`, params);

      let result;

      switch (action) {
        case "healthCheck":
          result = await healthCheck();
          break;

        case "getDatabases":
          result = await getDatabases();
          break;

        case "getSites":
          result = await getSites(params);
          break;

        case "getStortrackData":
          result = await getStortrackData(params.endpoint, params.queryParams);
          break;

        case "queryDatabase":
          result = await queryDatabase(
            params.database,
            params.table,
            params.filters,
            params.limit,
          );
          break;

        case "getAnalytics":
          result = await getAnalytics(params.type);
          break;

        case "getStorEdgeData":
          result = await getStorEdgeData(params.endpoint, params.queryParams);
          break;

        case "getSalesforceMetadataByAddress":
          result = await getSalesforceMetadataByAddress(params);
          break;

        case "getSalesforceByName":
          result = await getSalesforceByName(params.storeName);
          break;

        case "getTrailing12MonthRates": {
          const storeIds = params.storeIds || [];
          if (storeIds.length === 0) {
            throw new Error("storeIds is required for getTrailing12MonthRates");
          }
          const storeIdList = storeIds
            .map((id: string | number) => `'${id}'`)
            .join(",");
          const fromDate =
            params.fromDate ||
            new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0];
          const toDate =
            params.toDate || new Date().toISOString().split("T")[0];

          const rateSql = `
            SELECT 
              r.Store_ID,
              s.Name as Store_Name,
              s.Street_Address,
              s.City,
              s.State,
              s.Zip,
              r.Size,
              r.Width,
              r.Length,
              r.Spacetype,
              r.CC as Climate_Controlled,
              r.Humidity_Controlled,
              r.Drive_Up,
              r.Elevator,
              r.Outdoor_Access,
              r.Regular_Rate,
              r.Online_Rate,
              r.Promo,
              r.Date_Collected
            FROM dbo.Rates r
            LEFT JOIN dbo.Stores s ON r.Store_ID = s.ID
            WHERE r.Store_ID IN (${storeIdList})
            AND r.Date_Collected >= '${fromDate}'
            AND r.Date_Collected <= '${toDate}'
            ORDER BY r.Store_ID, r.Date_Collected DESC, r.Width, r.Length
          `;

          const rawResult = await universalQuery("Stortrack", rateSql);
          // universalQuery already extracts the results array, so rawResult is the array directly
          const rows = Array.isArray(rawResult) ? rawResult : [];
          console.log(
            `getTrailing12MonthRates: Processing ${rows.length} rate records`,
          );

          const ratesByStore: Record<number, any[]> = {};
          const datesByStore: Record<number, Set<string>> = {};

          for (const row of rows) {
            const storeId = row.Store_ID;

            if (!ratesByStore[storeId]) {
              ratesByStore[storeId] = [];
              datesByStore[storeId] = new Set();
            }

            const features: string[] = [];
            if (row.Climate_Controlled) features.push("Climate Controlled");
            if (row.Humidity_Controlled) features.push("Humidity Controlled");
            if (row.Drive_Up) features.push("Drive Up");
            if (row.Elevator) features.push("Elevator");
            if (row.Outdoor_Access) features.push("Outdoor Access");

            ratesByStore[storeId].push({
              storeId: storeId,
              storeName: row.Store_Name || "",
              address: row.Street_Address || "",
              city: row.City || "",
              state: row.State || "",
              zip: row.Zip || "",
              unitType: row.Spacetype || "Standard",
              size: row.Size || "",
              width: row.Width,
              length: row.Length,
              features: features.join(", "),
              tag: row.Spacetype || "Standard",
              climateControlled: !!row.Climate_Controlled,
              humidityControlled: !!row.Humidity_Controlled,
              driveUp: !!row.Drive_Up,
              elevator: !!row.Elevator,
              outdoorAccess: !!row.Outdoor_Access,
              walkInPrice: row.Regular_Rate,
              onlinePrice: row.Online_Rate,
              pctDifference:
                row.Regular_Rate && row.Online_Rate
                  ? ((row.Regular_Rate - row.Online_Rate) / row.Regular_Rate) *
                    100
                  : 0,
              date: row.Date_Collected || "",
              promo: row.Promo || "",
              source: "Database" as const,
            });

            if (row.Date_Collected) {
              datesByStore[storeId].add(row.Date_Collected);
            }
          }

          const datesByStoreArrays: Record<number, string[]> = {};
          for (const [storeId, dates] of Object.entries(datesByStore)) {
            datesByStoreArrays[Number(storeId)] = Array.from(dates)
              .sort()
              .reverse();
          }

          result = { ratesByStore, datesByStore: datesByStoreArrays };
          break;
        }

        case "getStoreInfo": {
          const storeIds = params.storeIds || [];
          if (storeIds.length === 0) {
            throw new Error("storeIds is required for getStoreInfo");
          }
          const storeIdList = storeIds
            .map((id: string | number) => `'${id}'`)
            .join(",");

          const storeSql = `
            SELECT 
              ID as Store_ID,
              Name,
              Street_Address,
              City,
              State,
              Zip,
              Country,
              Phone,
              Latitude,
              Longitude
            FROM dbo.Stores
            WHERE ID IN (${storeIdList})
          `;
          result = await universalQuery("Stortrack", storeSql);
          break;
        }

        case "getSalesforceMatches":
          result = await getSalesforceMetadataByAddress({
            street: params.streetAddress || "",
            city: "",
            state: "",
            postalCode: "",
            storeName: params.storeName,
          });
          break;

        case "getLatestRates": {
          const storeIds = params.storeIds || [];
          if (storeIds.length === 0) {
            throw new Error("storeIds is required for getLatestRates");
          }
          const storeIdList = storeIds
            .map((id: string | number) => `'${id}'`)
            .join(",");
          const daysBack = params.daysBack || 7;

          const latestRateSql = `
            SELECT
              r.Store_ID,
              s.Name as Store_Name,
              s.Street_Address,
              s.City,
              s.State,
              s.Zip,
              r.Size,
              r.Width,
              r.Length,
              r.Spacetype,
              r.CC as Climate_Controlled,
              r.Humidity_Controlled,
              r.Drive_Up,
              r.Elevator,
              r.Outdoor_Access,
              r.Regular_Rate,
              r.Online_Rate,
              r.Promo,
              r.Date_Collected
            FROM dbo.Rates r
            LEFT JOIN dbo.Stores s ON r.Store_ID = s.ID
            WHERE r.Store_ID IN (${storeIdList})
            AND r.Date_Collected >= DATEADD(day, -${daysBack}, GETDATE())
            ORDER BY r.Store_ID, r.Date_Collected DESC, r.Width, r.Length
          `;
          result = await universalQuery("Stortrack", latestRateSql);
          break;
        }

        case "saveRatesToS3": {
          // Upload API-fetched rates to S3 for later import by Python script
          // This works around the read-only MCP API limitation
          const rates = params.rates || [];
          const metadata = params.metadata || {};

          console.log(`saveRatesToS3: Received ${rates.length} rates to save`);

          if (!Array.isArray(rates) || rates.length === 0) {
            console.warn("saveRatesToS3: No rates provided or empty array");
            result = { uploaded: false, message: "No rates to save" };
            break;
          }

          if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
            console.warn("saveRatesToS3: AWS credentials not configured - AWS_ACCESS_KEY_ID:", !!AWS_ACCESS_KEY_ID, "AWS_SECRET_ACCESS_KEY:", !!AWS_SECRET_ACCESS_KEY);
            result = { uploaded: false, message: "AWS credentials not configured" };
            break;
          }

          console.log(`saveRatesToS3: AWS credentials configured, bucket: ${AWS_S3_BUCKET}, region: ${AWS_S3_REGION}`);

          console.log(`saveRatesToS3: Uploading ${rates.length} rate records to S3`);

          try {
            // Generate a unique filename with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `rate-import-${timestamp}.json`;

            // Prepare the payload in a format compatible with fill_missing_rates.py
            const payload = {
              exportedAt: new Date().toISOString(),
              source: 'RCA App API Fetch',
              metadata: {
                subjectStoreId: metadata.subjectStoreId,
                analysisId: metadata.analysisId,
                userEmail: metadata.userEmail,
                ...metadata
              },
              recordCount: rates.length,
              rates: rates.map((rate: any) => ({
                storeId: rate.storeId,
                storeName: rate.storeName,
                address: rate.address,
                city: rate.city,
                state: rate.state,
                zip: rate.zip,
                spacetype: rate.unitType || rate.spacetype || 'Standard',
                size: rate.size,
                width: rate.width || 0,
                length: rate.length || 0,
                height: rate.height || 0,
                climateControlled: rate.climateControlled || false,
                humidityControlled: rate.humidityControlled || false,
                outdoorAccess: rate.outdoorAccess || false,
                driveUp: rate.driveUp || false,
                elevator: rate.elevator || false,
                regularRate: rate.walkInPrice || rate.regularRate || null,
                onlineRate: rate.onlinePrice || rate.onlineRate || null,
                promo: rate.promo || '',
                dateCollected: rate.date || rate.dateCollected || '',
              }))
            };

            // Upload to S3 using AWS SDK v4 signature
            const body = JSON.stringify(payload, null, 2);
            const contentType = 'application/json';
            const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
            const dateStamp = amzDate.slice(0, 8);

            // Create the canonical request for AWS Signature v4
            const method = 'PUT';
            const host = `${AWS_S3_BUCKET}.s3.${AWS_S3_REGION}.amazonaws.com`;
            const canonicalUri = `/${filename}`;

            // For simplicity, use a pre-signed URL approach via fetch
            // Note: In production, use @aws-sdk/client-s3
            const s3Url = `https://${host}${canonicalUri}`;

            // Create authorization using AWS4 signature (simplified)
            const crypto = await import('crypto');

            const getSignatureKey = (key: string, dateStamp: string, regionName: string, serviceName: string) => {
              const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
              const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
              const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
              const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
              return kSigning;
            };

            const payloadHash = crypto.createHash('sha256').update(body).digest('hex');

            const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
            const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

            const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
            const canonicalRequestHash = crypto.createHash('sha256').update(canonicalRequest).digest('hex');

            const algorithm = 'AWS4-HMAC-SHA256';
            const credentialScope = `${dateStamp}/${AWS_S3_REGION}/s3/aws4_request`;
            const stringToSign = `${algorithm}\n${amzDate}\n${credentialScope}\n${canonicalRequestHash}`;

            const signingKey = getSignatureKey(AWS_SECRET_ACCESS_KEY, dateStamp, AWS_S3_REGION, 's3');
            const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

            const authorization = `${algorithm} Credential=${AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

            const response = await fetch(s3Url, {
              method: 'PUT',
              headers: {
                'Content-Type': contentType,
                'x-amz-content-sha256': payloadHash,
                'x-amz-date': amzDate,
                'Authorization': authorization,
              },
              body: body,
            });

            if (response.ok) {
              console.log(`saveRatesToS3: Successfully uploaded ${filename} with ${rates.length} records`);
              result = {
                uploaded: true,
                filename,
                recordCount: rates.length,
                s3Path: `s3://${AWS_S3_BUCKET}/${filename}`,
                message: `Uploaded ${rates.length} rate records to S3 for database import`
              };
            } else {
              const errorText = await response.text();
              console.error(`saveRatesToS3: Upload failed - ${response.status}: ${errorText}`);
              result = {
                uploaded: false,
                error: `S3 upload failed: ${response.status}`,
                message: errorText
              };
            }
          } catch (uploadError) {
            const errorMsg = uploadError instanceof Error ? uploadError.message : String(uploadError);
            console.error(`saveRatesToS3: Exception - ${errorMsg}`);
            result = {
              uploaded: false,
              error: errorMsg,
              message: `Failed to upload rates to S3: ${errorMsg}`
            };
          }
          break;
        }

        default:
          throw new Error(`Unknown action: ${action}`);
      }

      res.json({ success: true, data: result });
    } catch (error: unknown) {
      console.error("Database query error:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(500).json({ success: false, error: message });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
