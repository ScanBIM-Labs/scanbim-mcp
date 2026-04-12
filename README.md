# ScanBIM MCP — The AI Hub for AEC

[![Live](https://img.shields.io/badge/status-live-brightgreen)](https://scanbim-mcp.itmartin24.workers.dev/)
[![MCP](https://img.shields.io/badge/protocol-MCP%202025--03--26-blue)](https://modelcontextprotocol.io)
[![Tools](https://img.shields.io/badge/tools-46%20real-orange)](https://scanbim-mcp.itmartin24.workers.dev/info)
[![APS](https://img.shields.io/badge/APS-connected-green)](https://aps.autodesk.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Give Claude, ChatGPT, and any AI agent the ability to upload, convert, view, analyze, and share BIM models across 50+ formats.**

Upload a .rvt file. Get back a shareable 3D viewer link with QR code. Run clash detection with 20 years of VDC intelligence. Create RFIs. Launch VR walkthroughs. No software install needed.

---

## Ecosystem (5 Workers, 46 Tools)

| Worker | Version | Tools | Endpoint | Description |
|--------|---------|-------|----------|-------------|
| **scanbim-mcp** | v1.0.5 | 19 | [/mcp](https://scanbim-mcp.itmartin24.workers.dev/mcp) | Core hub — models, clashes, ACC, XR, viewer, rendering |
| **revit-mcp** | v1.1.0 | 8 | [/mcp](https://revit-mcp.itmartin24.workers.dev/mcp) | Revit — elements, parameters, schedules, sheets, IFC export |
| **acc-mcp** | v1.0.1 | 9 | [/mcp](https://acc-mcp.itmartin24.workers.dev/mcp) | ACC/BIM 360 — issues, RFIs, documents, project summaries |
| **navisworks-mcp** | v1.1.0 | 5 | [/mcp](https://navisworks-mcp.itmartin24.workers.dev/mcp) | Navisworks — clash detection, coordination, viewpoints |
| **twinmotion-mcp** | v1.1.0 | 5 | [/mcp](https://twinmotion-mcp.itmartin24.workers.dev/mcp) | Visualization — renders, environments, video, scenes |

**All 46 tools make real Autodesk Platform Services API calls.** Zero stubs. Verified April 12, 2026.

---

## scanbim-mcp Tools (19)

| Tool | Description |
|------|-------------|
| `upload_model` | Upload 3D models (Revit, IFC, point clouds, 50+ formats) via APS OSS + SVF2 translation |
| `detect_clashes` | VDC-grade clash detection with D1 rules database (SMACNA, NEC, ACI 318) |
| `get_viewer_link` | Generate APS Viewer URL + QR code for any translated model |
| `list_models` | List all uploaded models in APS buckets |
| `get_model_metadata` | Get APS translation status, manifest, and metadata |
| `get_supported_formats` | List supported file formats by tier (free/pro/enterprise) |
| `acc_list_projects` | List ACC/BIM 360 hubs and projects |
| `acc_create_issue` | Create ACC issues with priority, assignment, due dates |
| `acc_list_issues` | List/filter ACC issues by status and priority |
| `acc_create_rfi` | Create ACC RFIs |
| `acc_list_rfis` | List/filter ACC RFIs |
| `acc_search_documents` | Search ACC project documents by keyword |
| `acc_project_summary` | Get project overview with issue/RFI counts |
| `xr_launch_vr_session` | Launch VR viewing session (Meta Quest 2/3/3S) |
| `xr_launch_ar_session` | Launch AR overlay session |
| `xr_list_sessions` | List active XR sessions |
| `twinmotion_render` | Generate photorealistic renders via APS |
| `twinmotion_walkthrough` | Create animated walkthrough sequences |
| `lumion_render` | Architectural visualization rendering |

## revit-mcp Tools (8)

| Tool | Description |
|------|-------------|
| `revit_upload` | Upload .rvt files to APS with SVF2 translation |
| `revit_get_elements` | Extract elements by category (walls, doors, windows, etc.) |
| `revit_get_parameters` | Get element parameters with parameter group extraction |
| `revit_run_schedule` | Extract tabular schedule data from model properties |
| `revit_clash_detect` | Bounding box overlap + level proximity + D1 VDC rules |
| `revit_export_ifc` | Model Derivative IFC translation job |
| `revit_get_sheets` | List 2D views + sheet enumeration |
| `revit_get_views` | List all metadata views with detail levels |

## acc-mcp Tools (9)

| Tool | Description |
|------|-------------|
| `acc_list_projects` | List all ACC/BIM 360 hubs and projects |
| `acc_create_issue` | Create quality/safety issues |
| `acc_update_issue` | Update issue status, priority, assignment |
| `acc_list_issues` | List/filter issues by status and priority |
| `acc_create_rfi` | Create RFIs with assignment and priority |
| `acc_list_rfis` | List/filter RFIs |
| `acc_search_documents` | Full-text document search across projects |
| `acc_upload_file` | Upload files via APS Data Management (4-step flow) |
| `acc_project_summary` | Project dashboard with hub/project/issue/RFI counts |

## navisworks-mcp Tools (5)

| Tool | Description |
|------|-------------|
| `nwd_upload` | Upload .nwd/.nwc files with SVF2 translation |
| `nwd_get_clashes` | Cross-category clash analysis with level proximity + D1 VDC rules |
| `nwd_export_report` | Generate coordination report with category breakdown |
| `nwd_get_viewpoints` | Extract saved viewpoints and camera positions |
| `nwd_list_objects` | Property-based object listing with keyword filter |

## twinmotion-mcp Tools (5)

| Tool | Description |
|------|-------------|
| `tm_import_rvt` | Import .rvt via APS with SVF2 + thumbnail translation |
| `tm_set_environment` | Configure environment settings (time, weather, season) |
| `tm_render_image` | APS thumbnail rendering with resolution control |
| `tm_export_video` | OBJ derivative for offline rendering pipeline |
| `tm_list_scenes` | Enumerate scenes from metadata views + object tree |

---

## Endpoints (scanbim-mcp)

| Path | Method | Description |
|------|--------|-------------|
| `/mcp` | POST | MCP JSON-RPC 2.0 endpoint (initialize, tools/list, tools/call, ping) |
| `/info` | GET | Server info, version, tool count, APS connection status |
| `/health` | GET | Health check with APS configuration status |
| `/token` | GET | APS access token (viewables:read scope) for Viewer JS integration |
| `/viewer?urn=XXX` | GET | Built-in APS Viewer JS v7 — load any translated model in-browser |

---

## Quick Start

### Use the hosted MCP (Recommended)

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "scanbim": {
      "url": "https://scanbim-mcp.itmartin24.workers.dev/mcp"
    },
    "revit": {
      "url": "https://revit-mcp.itmartin24.workers.dev/mcp"
    },
    "acc": {
      "url": "https://acc-mcp.itmartin24.workers.dev/mcp"
    },
    "navisworks": {
      "url": "https://navisworks-mcp.itmartin24.workers.dev/mcp"
    },
    "twinmotion": {
      "url": "https://twinmotion-mcp.itmartin24.workers.dev/mcp"
    }
  }
}
```

### curl

```bash
# Health check
curl https://scanbim-mcp.itmartin24.workers.dev/health

# List tools
curl -X POST https://scanbim-mcp.itmartin24.workers.dev/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

# View a model
open "https://scanbim-mcp.itmartin24.workers.dev/viewer?urn=YOUR_BASE64_URN"
```

### Deploy your own

```bash
git clone https://github.com/ScanBIM-Labs/scanbim-mcp.git
cd scanbim-mcp
npm install
npx wrangler secret put APS_CLIENT_ID
npx wrangler secret put APS_CLIENT_SECRET
npx wrangler deploy
```

---

## Architecture

```
Claude / ChatGPT / Any AI Agent
    | MCP Protocol (JSON-RPC 2.0)
    v
Cloudflare Workers (5 workers, edge compute, <50ms global)
    |-- scanbim-mcp (19 tools + /viewer + /token)
    |-- revit-mcp (8 tools)
    |-- acc-mcp (9 tools)
    |-- navisworks-mcp (5 tools)
    |-- twinmotion-mcp (5 tools)
    |
    |-- D1 Database (VDC rules, clash severity, coordination standards)
    |-- KV Namespace (APS token caching with TTL)
    |
    v
Autodesk Platform Services (APS)
    |-- Authentication v2 (2-legged client credentials)
    |-- Model Derivative v2 (SVF2 translation, metadata, properties)
    |-- Object Storage Service (file upload, bucket management)
    |-- ACC Issues/RFIs API
    |-- APS Viewer JS v7 (browser-based 3D rendering)
    |
    v
scanbim.app (Cloudflare Pages) + APS Viewer (/viewer route)
```

---

## Supported Formats (50+)

**Free:** IFC, glTF/GLB, OBJ, STL, PLY, E57, LAS/LAZ, DXF, DAE, 3DS, 3MF

**Pro ($49/mo):** + FBX, DWG, STEP/STP, IGES, SketchUp (.skp), DWF, SolidWorks (.sldprt/.sldasm), Inventor (.ipt/.iam), OSGB

**Enterprise ($149/mo):** + **Revit (.rvt/.rfa)**, **Navisworks (.nwd/.nwc)**, ReCap (.rcp/.rcs), PCD, PTS, FLS, PTX, PTG, ZFS, 3MX + 500M point clouds + ACC integration

---

## VDC Intelligence Engine

Clash detection powered by **20 years of field experience** encoded into D1-backed rules:

- **9 severity rules** — SMACNA, NEC, ACI 318, AISC, ASCE 7 standards
- **5 coordination standards** — MEP clearance, structural proximity
- **Fix suggestions** — Real construction advice, not generic "move element"
- **Rework estimation** — Hours-to-fix based on actual project data

---

## Links

- **APS Viewer:** https://scanbim-mcp.itmartin24.workers.dev/viewer
- **Health Check:** https://scanbim-mcp.itmartin24.workers.dev/health
- **Product Site:** https://scanbim.app
- **Company:** https://scanbimlabs.io
- **MCP Tools Page:** https://scanbimlabs.io/mcp

---

## License

MIT — Free for commercial use.

---

**[ScanBIM Labs](https://scanbimlabs.io)** — VDC + AI + Reality Capture
*20 years of BIM/VDC operations, now AI-native. Built by a VDC practitioner, not a dev shop.*
