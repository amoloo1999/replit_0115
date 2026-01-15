# RCA Tool - Rate Comparison Analysis

## Overview

This is a Rate Comparison Analysis (RCA) tool for self-storage facilities. The application enables users to search for storage facilities, select a subject store, identify competitors within a radius, gather metadata (year built, square footage), assign quality rankings, and generate CSV exports with rate comparison data.

The tool follows a multi-step wizard workflow: Search → Select Subject Store → Select Competitors → Metadata Entry → Rankings → Adjustments → Custom Names → Data Gaps → Feature Codes → Data Visualization/Export.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite with SWC for fast compilation
- **Routing**: React Router DOM for client-side navigation
- **State Management**: React Query for server state, local React state for UI
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens defined in CSS variables
- **Fonts**: IBM Plex Sans (primary), JetBrains Mono (code/data)

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript compiled with esbuild for production
- **API Pattern**: Single `/api/stortrack` endpoint using action-based routing (POST with action + params)
- **Development**: Vite middleware integration for HMR during development

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` contains database table definitions
- **Migrations**: Generated to `./migrations` directory via drizzle-kit
- **Validation**: Zod schemas generated from Drizzle tables using drizzle-zod

### Project Structure
```
client/           # React frontend application
  src/
    components/   # UI components (ui/ for shadcn, rca/ for wizard steps)
    pages/        # Route page components
    hooks/        # Custom React hooks including useRCAWizard
    lib/          # Utilities and API client
    types/        # TypeScript type definitions
server/           # Express backend
  index.ts        # Server entry point
  routes.ts       # API route handlers
  db.ts           # Database connection
  storage.ts      # Data access layer
shared/           # Shared code between client/server
  schema.ts       # Drizzle database schema
```

### Key Design Patterns
- **Wizard Pattern**: Multi-step form flow managed by `useRCAWizard` hook
- **Component Composition**: Step components receive state and callbacks as props
- **API Abstraction**: All external API calls go through `lib/api.ts` functions
- **Type Safety**: Comprehensive TypeScript types in `types/rca.ts`

## External Dependencies

### Third-Party APIs
- **StorTrack API**: Self-storage industry data provider for store search, competitor discovery, and rate data. Requires `STORTRACK_BASEURL`, `STORTRACK_USERNAME`, `STORTRACK_PASSWORD` environment variables. Uses OAuth token authentication with caching.
- **MCP Server**: External service at `mcp.wwgmcpserver.com` for Salesforce data matching. Requires `WWG_MCP_API_KEY` environment variable.
- **Supabase**: Client SDK included for potential auth/database features (currently minimal usage)

### Database
- **PostgreSQL**: Primary database accessed via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe query builder and schema management

### Required Environment Variables
- `DATABASE_URL` - PostgreSQL connection string
- `STORTRACK_BASEURL` - StorTrack API base URL
- `STORTRACK_USERNAME` - StorTrack API username
- `STORTRACK_PASSWORD` - StorTrack API password
- `WWG_MCP_API_KEY` - MCP server API key for Salesforce matching