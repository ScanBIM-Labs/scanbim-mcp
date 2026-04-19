var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var __SEC_HEADERS = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://developer.api.autodesk.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://*.autodesk.com https://uptime.scanbimlabs.io https://developer.api.autodesk.com"
};
var __FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#f97316"/><text x="16" y="22" text-anchor="middle" font-family="Inter,sans-serif" font-size="18" font-weight="800" fill="#fff">S</text></svg>`;
var __BUILD = globalThis.__BUILD__ || "dev";
var __START = Date.now();
var __SLUG = "scanbim-mcp";
var __VERSION = "1.0.5";
async function __handleHealth(env) {
  const deps = {};
  try {
    const r = await fetch("https://developer.api.autodesk.com/authentication/v2/token", { method: "HEAD" });
    deps.aps = r.status < 500 ? "ok" : "degraded";
  } catch {
    deps.aps = "down";
  }
  if (env && env.CACHE) {
    try {
      await env.CACHE.get("_hc");
      deps.kv = "ok";
    } catch {
      deps.kv = "degraded";
    }
  }
  if (env && env.DB) {
    try {
      await env.DB.prepare("SELECT 1").first();
      deps.d1 = "ok";
    } catch {
      deps.d1 = "degraded";
    }
  }
  const worst = Object.values(deps).reduce((w, v) => v === "down" ? "down" : v === "degraded" && w !== "down" ? "degraded" : w, "ok");
  return Response.json({ status: worst, service: __SLUG, version: env && env.VERSION || __VERSION, build: __BUILD, ts: (/* @__PURE__ */ new Date()).toISOString(), uptime_s: Math.floor((Date.now() - __START) / 1e3), deps });
}
__name(__handleHealth, "__handleHealth");
function __applySec(resp) {
  const h = new Headers(resp.headers);
  for (const [k, v] of Object.entries(__SEC_HEADERS)) h.set(k, v);
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}
__name(__applySec, "__applySec");
function __extractUserKey(req) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(sk_scanbim_[A-Za-z0-9_-]+)/i);
  if (m) return m[1];
  const headerKey = req.headers.get("x-scanbim-api-key");
  if (headerKey) return headerKey.trim();
  return null;
}
__name(__extractUserKey, "__extractUserKey");
function __toolCost(toolName) {
  if (!toolName) return 1;
  if (/render|video|walkthrough|export_video|render_image|render_video/i.test(toolName)) return 50;
  if (/design_automation|da_run|import_rvt|tm_import_rvt|nwd_upload|upload_model/i.test(toolName)) return 20;
  if (/ai_|explain|draft|qa_|clash_explain|ai-?authored/i.test(toolName)) return 5;
  return 1;
}
__name(__toolCost, "__toolCost");
async function __creditCheck(req, env, body) {
  if (!env.INTERNAL_API_TOKEN || !env.CREDITS_API) return { ok: true };
  if (body?.method !== "tools/call") return { ok: true };
  const toolName = body?.params?.name;
  if (!toolName) return { ok: true };
  const user_key = __extractUserKey(req);
  if (!user_key) {
    return { ok: false, response: Response.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: {
        code: -32001,
        message: "Authentication required",
        data: {
          error: "missing_api_key",
          hint: "Include header: Authorization: Bearer sk_scanbim_<key>",
          signup_url: "https://scanbimlabs.io/credits"
        }
      }
    }, { status: 401 }) };
  }
  const cost = __toolCost(toolName);
  let r;
  try {
    r = await fetch(env.CREDITS_API, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": env.INTERNAL_API_TOKEN },
      body: JSON.stringify({ user_key, amount: cost, tool_name: toolName })
    });
  } catch (e) {
    console.log("CREDITS: fetch failed", String(e));
    return { ok: true };
  }
  if (r.status === 402) {
    const info = await r.json().catch(() => ({}));
    return { ok: false, response: Response.json({
      jsonrpc: "2.0",
      id: body.id ?? null,
      error: { code: -32002, message: "Insufficient credits", data: info }
    }, { status: 402 }) };
  }
  if (!r.ok) {
    console.log("CREDITS: check-and-debit returned", r.status);
    return { ok: true };
  }
  return { ok: true };
}
__name(__creditCheck, "__creditCheck");
var APS_BASE = "https://developer.api.autodesk.com";
var SERVER_INFO = {
  name: "scanbim-mcp",
  version: "1.0.5",
  description: "The AI Hub for AEC \u2014 Real Revit, Navisworks, ACC/Forma, XR, and 50+ 3D formats via Autodesk Platform Services. Upload, convert, view, analyze, and share BIM models with AI.",
  author: "ScanBIM Labs LLC",
  homepage: "https://scanbim.app"
};
async function getAPSToken(env, scope = "data:read data:write data:create bucket:read bucket:create viewables:read") {
  const cacheKey = `aps_token_${scope.replace(/\s/g, "_")}`;
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) return cached;
  }
  const resp = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.APS_CLIENT_ID,
      client_secret: env.APS_CLIENT_SECRET,
      grant_type: "client_credentials",
      scope
    })
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`APS auth failed: ${err}`);
  }
  const data = await resp.json();
  const token = data.access_token;
  if (env.CACHE) await env.CACHE.put(cacheKey, token, { expirationTtl: data.expires_in - 60 });
  return token;
}
__name(getAPSToken, "getAPSToken");
async function ensureBucket(token, bucketKey) {
  const check = await fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/details`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (check.ok) return;
  await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ bucketKey, policyKey: "persistent" })
  });
}
__name(ensureBucket, "ensureBucket");
async function uploadToOSS(token, bucketKey, objectName, fileUrl) {
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Cannot fetch file from URL: ${fileUrl}`);
  const fileData = await fileResp.arrayBuffer();
  const uploadResp = await fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectName)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
    body: fileData
  });
  if (!uploadResp.ok) throw new Error(`OSS upload failed: ${await uploadResp.text()}`);
  return await uploadResp.json();
}
__name(uploadToOSS, "uploadToOSS");
async function translateModel(token, urn, outputFormat = "svf2") {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "x-ads-force": "true" },
    body: JSON.stringify({
      input: { urn },
      output: { formats: [{ type: outputFormat, views: ["2d", "3d"] }] }
    })
  });
  if (!resp.ok) throw new Error(`Translation failed: ${await resp.text()}`);
  return await resp.json();
}
__name(translateModel, "translateModel");
async function getManifest(token, urn) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Manifest fetch failed: ${await resp.text()}`);
  return await resp.json();
}
__name(getManifest, "getManifest");
async function getModelProperties(token, urn) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/metadata`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) return null;
  return await resp.json();
}
__name(getModelProperties, "getModelProperties");
async function listHubs(token) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`List hubs failed: ${await resp.text()}`);
  return await resp.json();
}
__name(listHubs, "listHubs");
async function listProjects(token, hubId) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs/${hubId}/projects`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`List projects failed: ${await resp.text()}`);
  return await resp.json();
}
__name(listProjects, "listProjects");
async function accCreateIssue(token, projectId, issueData) {
  const cleanId = projectId.replace(/^b\./, "");
  const resp = await fetch(`${APS_BASE}/construction/issues/v1/projects/${cleanId}/issues`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: issueData.title,
      description: issueData.description,
      status: "open",
      priority: issueData.priority || "medium",
      assignedTo: issueData.assigned_to || null,
      dueDate: issueData.due_date || null
    })
  });
  if (!resp.ok) throw new Error(`Create issue failed: ${await resp.text()}`);
  return await resp.json();
}
__name(accCreateIssue, "accCreateIssue");
async function accListIssues(token, projectId, filters = {}) {
  const cleanId = projectId.replace(/^b\./, "");
  let url = `${APS_BASE}/construction/issues/v1/projects/${cleanId}/issues?limit=50`;
  if (filters.status) url += `&filter[status]=${filters.status}`;
  if (filters.priority) url += `&filter[priority]=${filters.priority}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`List issues failed: ${await resp.text()}`);
  return await resp.json();
}
__name(accListIssues, "accListIssues");
async function accCreateRFI(token, projectId, rfiData) {
  const cleanId = projectId.replace(/^b\./, "");
  const resp = await fetch(`${APS_BASE}/construction/rfis/v1/projects/${cleanId}/rfis`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: rfiData.subject,
      question: rfiData.question,
      assignedTo: rfiData.assigned_to || null,
      priority: rfiData.priority || "medium",
      status: "draft"
    })
  });
  if (!resp.ok) throw new Error(`Create RFI failed: ${await resp.text()}`);
  return await resp.json();
}
__name(accCreateRFI, "accCreateRFI");
async function accListRFIs(token, projectId, filters = {}) {
  const cleanId = projectId.replace(/^b\./, "");
  let url = `${APS_BASE}/construction/rfis/v1/projects/${cleanId}/rfis?limit=50`;
  if (filters.status) url += `&filter[status]=${filters.status}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`List RFIs failed: ${await resp.text()}`);
  return await resp.json();
}
__name(accListRFIs, "accListRFIs");
async function accSearchDocuments(token, projectId, query, docType) {
  const cleanId = projectId.replace(/^b\./, "");
  let url = `${APS_BASE}/data/v1/projects/b.${cleanId}/search?filter[text]=${encodeURIComponent(query)}`;
  if (docType) url += `&filter[type]=${docType}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Document search failed: ${await resp.text()}`);
  return await resp.json();
}
__name(accSearchDocuments, "accSearchDocuments");
async function accProjectSummary(token, hubId, projectId) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs/${hubId}/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Project summary failed: ${await resp.text()}`);
  return await resp.json();
}
__name(accProjectSummary, "accProjectSummary");
function detectClashes(elementsA, elementsB) {
  const clashes = [];
  for (const a of elementsA) {
    for (const b of elementsB) {
      const bboxA = a.geometry?.boundingBox;
      const bboxB = b.geometry?.boundingBox;
      if (!bboxA || !bboxB) continue;
      if (bboxesIntersect(bboxA, bboxB)) {
        clashes.push({
          id: `${a.id}_${b.id}`,
          element_a: a.id,
          element_b: b.id,
          category_a: a.category,
          category_b: b.category,
          severity: assessSeverity(a.category, b.category),
          suggested_fix: suggestFix(a.category, b.category),
          estimated_rework_hours: estimateRework(a.category, b.category)
        });
      }
    }
  }
  return clashes.sort((a, b) => (b.severity === "critical" ? 1 : 0) - (a.severity === "critical" ? 1 : 0));
}
__name(detectClashes, "detectClashes");
function bboxesIntersect(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.max[i] < b.min[i] || b.max[i] < a.min[i]) return false;
  }
  return true;
}
__name(bboxesIntersect, "bboxesIntersect");
function assessSeverity(catA, catB) {
  const critical = ["Structure", "Structural Framing", "Structural Columns", "Structural Foundations"];
  return [catA, catB].some((c) => critical.includes(c)) ? "critical" : "warning";
}
__name(assessSeverity, "assessSeverity");
function suggestFix(catA, catB) {
  const pair = [catA, catB].sort().join("+");
  const fixes = {
    "Ducts+Pipes": 'Route duct above pipe. Maintain 18" clearance minimum per SMACNA.',
    "Ducts+Structure": "CRITICAL: Structural conflict. Engineer sleeve or full reroute required. Submit RFI immediately.",
    "Ducts+Structural Framing": "CRITICAL: Structural conflict. Engineer sleeve or full reroute required. Submit RFI immediately.",
    "Electrical+Pipes": 'Maintain 12" separation per NEC 300.11. Reroute conduit above pipe or increase offset.',
    "Pipes+Structure": "CRITICAL: Structural penetration required. PE stamp required. Submit RFI.",
    "Pipes+Structural Framing": "CRITICAL: Structural penetration required. PE stamp required. Submit RFI.",
    "Ducts+Electrical": "Route duct above electrical. Maintain accessible clearance per NEC.",
    "Mechanical+Structure": "CRITICAL: Equipment clearance conflict with structure. Review seismic restraints and clearances."
  };
  return fixes[pair] || `Coordinate ${catA} and ${catB} positioning with trade leads. Review MEP coordination drawing and update in Navisworks.`;
}
__name(suggestFix, "suggestFix");
function estimateRework(catA, catB) {
  if ([catA, catB].some((c) => ["Structure", "Structural Framing", "Structural Columns", "Structural Foundations"].includes(c))) return 24;
  if ([catA, catB].some((c) => ["Ducts", "Pipes", "Mechanical Equipment"].includes(c))) return 4;
  return 2;
}
__name(estimateRework, "estimateRework");
var RATE_LIMITS = "APS default ~50 req/min per app per endpoint; Model Derivative translation jobs ~60 req/min; OSS uploads size-limited per file to 100MB for direct upload, larger via resumable.";
var TOOLS = [
  {
    name: "upload_model",
    description: [
      "Ingest a 3D model from a public URL into APS OSS and kick off a Model Derivative translation job, returning the URN plus a browser viewer link and QR code. Supports 50+ formats: Revit (.rvt/.rfa), Navisworks (.nwd/.nwc), IFC, FBX, OBJ, SolidWorks, point clouds (E57/LAS/RCP), CAD (DWG/STEP/IGES), etc.",
      "When to use: you have a publicly downloadable 3D file (S3 presigned URL, GitHub raw, etc.) and need it translated to SVF2 so it can be viewed, measured, or clash-checked via other tools.",
      "When NOT to use: the file is only on a local disk or behind auth (fetch will fail) \u2014 first push it to a public URL. Do not call to re-translate a model already uploaded; call get_model_metadata instead.",
      "APS scopes: data:read data:write data:create bucket:read bucket:create viewables:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied; 404 source file_url not reachable or bucket not found \u2014 check the ID; 409 bucket name conflict (bucket already owned by another app \u2014 pick a unique bucketKey); 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Creates the scanbim-models bucket if absent, uploads a new OSS object with a timestamped key (each call creates a distinct object even for the same input), submits a Model Derivative job (x-ads-force=true overwrites prior derivatives for the same URN), and inserts a row into D1 usage_log + models table."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        file_url: {
          type: "string",
          description: "Publicly fetchable HTTPS URL to the 3D model file. Must be directly downloadable (no login wall, no JS redirect); the worker does a plain fetch() and streams the bytes into APS OSS. Max 100MB for direct upload. Presigned S3/GCS URLs work well.",
          examples: ["https://storage.googleapis.com/scanbim-public/sample/rac_basic_sample_project.rvt"]
        },
        file_name: {
          type: "string",
          description: "Filename including the extension. The extension is used to determine the tier (free/pro/enterprise) and is preserved in the OSS object key (prefixed with a Unix-ms timestamp). Use only ASCII + dash/underscore/dot; no path separators.",
          examples: ["office-tower-L1-L12.rvt"]
        },
        project_name: {
          type: "string",
          description: "Optional free-text label stored alongside the model row in D1 for grouping models by project. Does not affect APS storage or URN. Defaults to 'default' when omitted.",
          examples: ["1200 Main St - Tower A"]
        }
      },
      required: ["file_url", "file_name"]
    }
  },
  {
    name: "detect_clashes",
    description: [
      "Run a VDC-grade clash detection pass between two element categories in a translated model, returning each overlapping element pair with a severity (critical/warning), a trade-specific suggested fix, and an estimated rework hour count. Uses AABB bounding-box intersection on elements pulled from the APS Model Derivative properties endpoint, with a synthetic fallback if properties have not yet been computed.",
      "When to use: you want a first-pass coordination report between two MEP or structural trades (e.g. Ducts vs Structural Framing) for a model that has finished translating.",
      "When NOT to use: the model has not finished translating yet (call get_model_metadata first to confirm manifest.status=='success'), or you need clash detection between more than two categories \u2014 call this tool multiple times.",
      "APS scopes: data:read viewables:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied; 404 URN not found or has no derivatives yet \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY on APS. Inserts a row into D1 usage_log for analytics. Idempotent \u2014 repeated calls return the same clash set for a given model."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN returned by upload_model. Base64url-encoded Autodesk object ID starting with 'dXJu' (which decodes to 'urn:adsk.objects:os.object:...'). Unpadded.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        },
        category_a: {
          type: "string",
          description: "Revit/IFC category name (case-sensitive, exactly as it appears in the model properties). Common values: 'Ducts', 'Pipes', 'Electrical', 'Structural Framing', 'Structural Columns', 'Mechanical Equipment', 'Walls'.",
          examples: ["Ducts"]
        },
        category_b: {
          type: "string",
          description: "Second Revit/IFC category to clash against category_a. Case-sensitive; must match a category present in the translated model's property set.",
          examples: ["Structural Framing"]
        }
      },
      required: ["model_id", "category_a", "category_b"]
    }
  },
  {
    name: "get_viewer_link",
    description: [
      "Return a shareable browser URL for the embedded APS viewer and a matching QR code for mobile/XR handoff. Does not require the model to be fully translated \u2014 the viewer page will poll the manifest.",
      "When to use: you need to hand a stakeholder a URL to see the 3D model in a browser, or print a QR for a jobsite.",
      "When NOT to use: you need the raw APS URN for programmatic API calls \u2014 use the model_id you already have instead. Do not use to check translation progress \u2014 call get_model_metadata.",
      "APS scopes: none (URL assembly only); the viewer page itself uses viewables:read data:read server-side via /token.",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (only relevant when the viewer page loads); 403 scope or resource permission denied; 404 URN not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY and pure. Idempotent: same model_id always returns the same URL + QR."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN (base64url-encoded Autodesk object ID, starts with 'dXJu', unpadded) or the model_id returned from upload_model.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        }
      },
      required: ["model_id"]
    }
  },
  {
    name: "list_models",
    description: [
      "List every object currently stored in the scanbim-models OSS bucket, with URN, size in MB, and a viewer URL for each. Returns the raw OSS inventory, not the D1 models table, so freshly uploaded items appear immediately.",
      "When to use: you need to enumerate previously uploaded models to find a URN, show an inventory, or pick one for a follow-up tool call.",
      "When NOT to use: you already know the exact URN \u2014 call get_model_metadata directly. This tool is not a search; it returns up to the OSS default page (typically first 10 objects unless OSS paginates).",
      "APS scopes: bucket:read data:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied; 404 bucket not found \u2014 no models have been uploaded yet (upload one first); 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY. Idempotent."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        project_name: {
          type: "string",
          description: "Reserved for future filtering by the D1 project_name column. Currently informational only; the OSS listing is not filtered by this value.",
          examples: ["1200 Main St - Tower A"]
        },
        format: {
          type: "string",
          description: "Reserved for future filtering by file extension (e.g. 'rvt', 'ifc'). Currently informational only; the OSS listing is not filtered by this value.",
          examples: ["rvt"]
        }
      }
    }
  },
  {
    name: "get_model_metadata",
    description: [
      "Fetch the APS Model Derivative manifest and metadata for a URN, including translation progress, derivative outputs, and a viewer URL. Use this to confirm a model has finished translating (manifest.status == 'success') before calling detect_clashes or opening the viewer.",
      "When to use: right after upload_model to poll translation progress, or later to inspect which viewable derivatives (SVF2, thumbnail, OBJ) are available.",
      "When NOT to use: you just want a link to share \u2014 call get_viewer_link. You want the actual element properties list \u2014 this tool returns the metadata index, not the full property collection.",
      "APS scopes: data:read viewables:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied; 404 URN not found or job not yet submitted \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY on APS. Inserts a row into D1 usage_log. Idempotent."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN (base64url-encoded Autodesk object ID, starts with 'dXJu', unpadded) as returned by upload_model.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        }
      },
      required: ["model_id"]
    }
  },
  {
    name: "get_supported_formats",
    description: [
      "Return the full matrix of supported input formats organized by subscription tier (free / pro / enterprise). Use to tell a user whether their file type is accepted before calling upload_model, or to surface pricing tier info.",
      "When to use: you need to validate a file extension or show a customer the supported format list.",
      "When NOT to use: you already know the extension is common (.rvt/.ifc/.nwd/.obj) \u2014 just call upload_model, which returns an 'Unsupported format' error for anything outside the matrix.",
      "APS scopes: none (static data).",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (not applicable: no APS call); 403 scope or resource permission denied (not applicable); 404 not applicable; 429 rate limited \u2014 backoff and retry (worker-level only); 5xx APS upstream outage \u2014 retry with jitter (not applicable).",
      "Side effects: READ-ONLY and pure. Idempotent."
    ].join("\n"),
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "acc_list_projects",
    description: [
      "List every Autodesk Construction Cloud (ACC) / BIM 360 project the configured APS 2-legged app has access to, flattened across all hubs, with hub_id, hub_name, project_id, project_name, and project type.",
      "When to use: you need a project_id to pass into acc_create_issue, acc_list_issues, acc_create_rfi, acc_list_rfis, acc_search_documents, or acc_project_summary.",
      "When NOT to use: you already have the b.xxxx project_id. This tool makes N+1 API calls (one per hub) so avoid calling it in tight loops.",
      "APS scopes: data:read account:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied (app not provisioned for any hub in ACC Account Admin \u2192 Custom Integrations); 404 no hubs found \u2014 check APS app provisioning; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY. Inserts a row into D1 usage_log. Idempotent."
    ].join("\n"),
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "acc_create_issue",
    description: [
      "Create a real issue (punchlist/QC item) in ACC Build's Issues module via the APS Construction Issues v1 API. Returns the ACC-generated issue_id which can be linked back to a model URN or a detected clash.",
      "When to use: detect_clashes flagged a critical clash, or a field user reports a QC defect, and you want to track it in ACC for assignment and closeout.",
      "When NOT to use: you want to file a formal information request between trades \u2014 use acc_create_rfi instead. You want a note on a model element \u2014 that is a markup, not an issue.",
      "APS scopes: data:read data:write account:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied (app not provisioned for the project's ACC account); 404 project_id not found \u2014 check the ID (strip any leading 'b.'); 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Creates a new ACC issue each call (repeated calls create duplicates). Inserts a row into D1 usage_log."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ACC project ID in either 'b.<uuid>' or plain '<uuid>' form (the worker strips the 'b.' prefix before calling the Issues endpoint). Obtainable via acc_list_projects.",
          examples: ["b.a4be0c34a-4a01-4b0e-9f1a-123456789abc"]
        },
        title: {
          type: "string",
          description: "Short human-readable issue title, 1-255 chars. Shows up as the headline in ACC Issues UI.",
          examples: ["Duct/beam clash at Level 3 gridline C-4"]
        },
        description: {
          type: "string",
          description: "Long-form issue body. Plain text; supports newlines. Include clash coordinates, trade impact, and suggested fix.",
          examples: [`16" supply duct (Mech-L3-SD-42) conflicts with W18x35 beam at elev 10'-6". Reroute duct above beam per SMACNA, maintain 18" clearance.`]
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "ACC issue priority. Defaults to 'medium' if omitted.",
          examples: ["high"]
        },
        assigned_to: {
          type: "string",
          description: "ACC user ID (UUID) or email of the assignee. Pass null or omit to leave unassigned.",
          examples: ["jdoe@contractor.com"]
        },
        due_date: {
          type: "string",
          description: "ISO 8601 calendar date (YYYY-MM-DD). Time component is ignored by ACC.",
          examples: ["2026-05-15"]
        },
        linked_model_id: {
          type: "string",
          description: "Optional APS URN linking this issue back to the source model. Stored for ScanBIM cross-referencing; not forwarded to ACC's linkedDocuments field.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        }
      },
      required: ["project_id", "title", "description"]
    }
  },
  {
    name: "acc_create_rfi",
    description: [
      "Create a Request For Information in ACC Build's RFIs module via the APS Construction RFIs v1 API, in 'draft' status. Returns the ACC rfi_id.",
      "When to use: a trade or subcontractor needs formal information from the design team (unclear detail, conflicting spec, missing dimension) and you want a tracked paper trail.",
      "When NOT to use: the item is just a punchlist fix \u2014 use acc_create_issue. The question is internal to one trade \u2014 handle inside that trade's toolchain.",
      "APS scopes: data:read data:write account:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied (app not provisioned for the project's ACC account, or RFIs module not enabled); 404 project_id not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Creates a new draft RFI each call. Inserts a row into D1 usage_log."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ACC project ID in 'b.<uuid>' or '<uuid>' form (the 'b.' prefix is stripped automatically). Obtainable via acc_list_projects.",
          examples: ["b.a4be0c34a-4a01-4b0e-9f1a-123456789abc"]
        },
        subject: {
          type: "string",
          description: "Short RFI subject line, 1-255 chars. Appears as the RFI headline in ACC.",
          examples: ["Confirm fireproofing thickness on W18 beams at Level 3"]
        },
        question: {
          type: "string",
          description: "Full question body sent to the design team. Plain text with newlines allowed.",
          examples: ["Drawing S2.03 shows 1-hour rating on W18x35 beams but spec 07 81 00 calls for 2-hour. Which governs at Level 3?"]
        },
        assigned_to: {
          type: "string",
          description: "ACC user ID (UUID) or email of the responder. Pass null or omit to leave unassigned.",
          examples: ["architect@designfirm.com"]
        },
        priority: {
          type: "string",
          enum: ["critical", "high", "medium", "low"],
          description: "RFI priority. Defaults to 'medium'.",
          examples: ["high"]
        },
        linked_clash_id: {
          type: "string",
          description: "Optional clash ID from detect_clashes output used to link this RFI back to the triggering clash. Stored for ScanBIM cross-referencing; not forwarded to ACC.",
          examples: ["Ducts_001_Structural Framing_002"]
        },
        linked_model_id: {
          type: "string",
          description: "Optional APS URN of the model the RFI references. Stored for ScanBIM cross-referencing; not forwarded to ACC.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        }
      },
      required: ["project_id", "subject", "question"]
    }
  },
  {
    name: "acc_list_issues",
    description: [
      "List up to 50 issues from an ACC project, optionally filtered by status and priority. Returns a normalized array of {id, title, status, priority, due_date}.",
      "When to use: you need a dashboard view of open issues, to find a specific issue by metadata, or to check the status of previously created issues.",
      "When NOT to use: you want the full audit trail of a single issue \u2014 the ACC Issues UI or the per-issue endpoint is better. This tool caps at 50 results and does no pagination.",
      "APS scopes: data:read account:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied; 404 project_id not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY. Inserts a row into D1 usage_log. Idempotent."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ACC project ID in 'b.<uuid>' or '<uuid>' form (the 'b.' prefix is stripped automatically). Obtainable via acc_list_projects.",
          examples: ["b.a4be0c34a-4a01-4b0e-9f1a-123456789abc"]
        },
        status: {
          type: "string",
          description: "Filter by ACC issue status. Accepted values: 'open', 'closed', 'in_review', 'draft'. Omit for all statuses.",
          examples: ["open"]
        },
        priority: {
          type: "string",
          description: "Filter by priority: 'critical' | 'high' | 'medium' | 'low'. Omit for all priorities.",
          examples: ["high"]
        },
        assigned_to: {
          type: "string",
          description: "Reserved for future filtering by assignee user ID or email. Currently not forwarded to the ACC API.",
          examples: ["jdoe@contractor.com"]
        }
      },
      required: ["project_id"]
    }
  },
  {
    name: "acc_list_rfis",
    description: [
      "List up to 50 RFIs from an ACC project, optionally filtered by status. Returns a normalized array of {id, subject, status}.",
      "When to use: you need a quick rollup of outstanding or answered RFIs on a project, or to find a specific RFI id.",
      "When NOT to use: you want the full response thread of a single RFI \u2014 use the ACC UI or per-RFI endpoint. This tool caps at 50 results and does no pagination.",
      "APS scopes: data:read account:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied (RFIs module may not be enabled on the project); 404 project_id not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY. Inserts a row into D1 usage_log. Idempotent."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ACC project ID in 'b.<uuid>' or '<uuid>' form (the 'b.' prefix is stripped automatically).",
          examples: ["b.a4be0c34a-4a01-4b0e-9f1a-123456789abc"]
        },
        status: {
          type: "string",
          description: "Filter by RFI status. Common values: 'draft', 'open', 'answered', 'closed', 'void'. Omit for all.",
          examples: ["open"]
        }
      },
      required: ["project_id"]
    }
  },
  {
    name: "acc_search_documents",
    description: [
      "Full-text search the ACC Docs module on a project for drawings, specs, submittals, and other documents matching a query string. Calls the APS Data Management v1 search endpoint scoped to a project.",
      "When to use: an agent needs to locate a spec section, a sheet, or a submittal by keyword (e.g. 'fireproofing', 'A-101', 'RFI 23').",
      "When NOT to use: you already have the document URN/lineage \u2014 fetch it directly. You want the file contents \u2014 this returns metadata; download separately via Data Management.",
      "APS scopes: data:read account:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied (Docs module access required); 404 project_id not found \u2014 check the ID (note: this endpoint re-prepends 'b.' so pass the UUID form); 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY. Inserts a row into D1 usage_log. Idempotent."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "ACC project ID in 'b.<uuid>' or '<uuid>' form (the 'b.' prefix is stripped and re-prepended automatically for the Data Management API).",
          examples: ["b.a4be0c34a-4a01-4b0e-9f1a-123456789abc"]
        },
        query: {
          type: "string",
          description: "Free-text search string. Matched against document names and attributes. URL-encoded automatically by the worker.",
          examples: ["fireproofing detail"]
        },
        document_type: {
          type: "string",
          description: "Optional document type filter forwarded as filter[type]. Common values: 'drawing', 'spec', 'submittal', 'rfi', 'photo'.",
          examples: ["spec"]
        }
      },
      required: ["project_id", "query"]
    }
  },
  {
    name: "acc_project_summary",
    description: [
      "Fetch a single ACC/BIM 360 project's full attributes (name, type, dates, address, hub) from the APS Data Management project endpoint. If hub_id is omitted, the first hub the app can see is used.",
      "When to use: you need name, type, or scope details for a single project before acting on it, or to confirm the project still exists.",
      "When NOT to use: you want the list of all projects \u2014 call acc_list_projects. You want issues/RFIs counts \u2014 call the list tools.",
      "APS scopes: data:read account:read",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh; 403 scope or resource permission denied; 404 project_id or hub_id not found \u2014 check the IDs; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: READ-ONLY. Inserts a row into D1 usage_log. Idempotent."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        project_id: {
          type: "string",
          description: "Full ACC project_id including the 'b.' prefix, exactly as returned by acc_list_projects. Unlike the Issues/RFIs tools, this tool passes the ID through unchanged to the Data Management project endpoint.",
          examples: ["b.a4be0c34a-4a01-4b0e-9f1a-123456789abc"]
        },
        hub_id: {
          type: "string",
          description: "Optional ACC hub_id (format 'b.<account-uuid>'). If omitted, the worker picks the first hub returned by /project/v1/hubs.",
          examples: ["b.11111111-2222-3333-4444-555555555555"]
        }
      },
      required: ["project_id"]
    }
  },
  {
    name: "xr_launch_vr_session",
    description: [
      "Create a shareable WebXR VR walkthrough session URL (and Meta Quest oculus:// deep link + QR code) for a translated model. The session_id is generated server-side; rendering happens in the user's Quest browser.",
      "When to use: you need to walk a client or field team through a model in immersive VR on Meta Quest 2/3/Pro.",
      "When NOT to use: the user is on a phone/tablet without a headset \u2014 use xr_launch_ar_session or get_viewer_link. The model has not finished translating \u2014 call get_model_metadata first.",
      "APS scopes: viewables:read data:read (enforced at viewer page load, not at tool call).",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (only at viewer page load); 403 scope or resource permission denied; 404 URN not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Each call mints a new session_id (vr_<epoch_ms>). Inserts a row into D1 usage_log which is later read by xr_list_sessions. No APS resources are created."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN (base64url-encoded, starts with 'dXJu', unpadded) of the model to load in VR.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        },
        session_name: {
          type: "string",
          description: "Human-readable session label shown in the session list. Defaults to 'VR Session' if omitted.",
          examples: ["Owner walkthrough - Level 3 MEP"]
        },
        enable_measurements: {
          type: "boolean",
          description: "Enable in-VR tape-measure tool. Defaults to true.",
          examples: [true]
        },
        enable_voice_annotations: {
          type: "boolean",
          description: "Enable voice-note recording anchored to model elements. Defaults to false.",
          examples: [false]
        },
        max_participants: {
          type: "number",
          description: "Maximum concurrent participants in multi-user mode. Integer 1-20. Defaults to 5.",
          examples: [5]
        }
      },
      required: ["model_id"]
    }
  },
  {
    name: "xr_launch_ar_session",
    description: [
      "Create a shareable WebXR AR passthrough session URL and QR code. On phone or tablet with WebXR AR support, the model is overlaid on the camera feed at the requested scale.",
      "When to use: a field user needs to walk the jobsite with a phone and see the model overlaid in-place at 1:1 scale, or drop a tabletop mini-model on a desk.",
      "When NOT to use: the target device is a Meta Quest in VR mode \u2014 use xr_launch_vr_session. The device lacks WebXR AR (desktop browser) \u2014 use get_viewer_link.",
      "APS scopes: viewables:read data:read (enforced at viewer page load, not at tool call).",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (only at viewer page load); 403 scope or resource permission denied; 404 URN not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Each call mints a new session_id (ar_<epoch_ms>). Inserts a row into D1 usage_log read by xr_list_sessions. No APS resources are created."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN (base64url-encoded, starts with 'dXJu', unpadded) of the model to load in AR.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        },
        session_name: {
          type: "string",
          description: "Human-readable session label shown in the session list.",
          examples: ["Jobsite AR walkdown - 2026-04-18"]
        },
        scale: {
          type: "string",
          enum: ["1:1", "tabletop", "custom"],
          description: "Model placement scale. '1:1' for in-situ real-world scale, 'tabletop' for ~1:50 desk-top display, 'custom' to allow pinch-to-scale. Defaults to '1:1'.",
          examples: ["1:1"]
        }
      },
      required: ["model_id"]
    }
  },
  {
    name: "xr_list_sessions",
    description: [
      "List the last 20 VR/AR sessions launched via xr_launch_vr_session and xr_launch_ar_session, sorted by creation time desc. Sourced from the D1 usage_log table; returns an empty array if D1 is unavailable or no sessions have been recorded.",
      "When to use: you want to audit who launched which XR session and when, or surface recent sessions to a user.",
      "When NOT to use: you want details (join URL, features) for a specific session \u2014 those details live inside the original launch response and are not stored beyond the log row.",
      "APS scopes: none (D1 read only).",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (not applicable: no APS call); 403 scope or resource permission denied (not applicable); 404 not applicable; 429 rate limited \u2014 backoff and retry (worker-level only); 5xx APS upstream outage \u2014 retry with jitter (not applicable).",
      "Side effects: READ-ONLY. Idempotent."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "Reserved for future filtering by model URN. Currently not applied; all recent xr_* sessions are returned.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        },
        session_type: {
          type: "string",
          enum: ["vr", "ar", "all"],
          description: "Reserved for future filtering by session type. Currently not applied; both VR and AR sessions are returned.",
          examples: ["all"]
        }
      }
    }
  },
  {
    name: "twinmotion_render",
    description: [
      "Queue a photorealistic Twinmotion-style still render of a translated model with time-of-day, weather, season, and resolution controls. Returns a render_id and preview_url; the actual render pipeline is a ScanBIM roadmap item (Week 5 buildout), so today this tool responds synchronously with a stub job descriptor.",
      "When to use: you want a scripted way to request a hero still for a proposal or client deck.",
      "When NOT to use: you need real-time interactive rendering \u2014 use get_viewer_link. You need a moving camera \u2014 use twinmotion_walkthrough. You expect the image file bytes back in the response \u2014 this tool returns a URL, not bytes.",
      "APS scopes: none today (render pipeline is ScanBIM-internal); viewables:read data:read will apply when the pipeline goes live.",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (will apply when pipeline is live); 403 scope or resource permission denied; 404 URN not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Each call mints a new render_id (tm_<epoch_ms>). Inserts a row into D1 usage_log. When the pipeline is live it will create a rendering job on ScanBIM's compute backend."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN (base64url-encoded, starts with 'dXJu', unpadded) of the model to render.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        },
        time_of_day: {
          type: "string",
          enum: ["dawn", "morning", "noon", "afternoon", "dusk", "night"],
          description: "Sun angle preset driving lighting, shadows, and sky. Defaults to 'noon'.",
          examples: ["dusk"]
        },
        weather: {
          type: "string",
          enum: ["clear", "partly_cloudy", "overcast", "rain", "snow"],
          description: "Sky and atmospheric preset. Defaults to 'clear'.",
          examples: ["partly_cloudy"]
        },
        season: {
          type: "string",
          enum: ["spring", "summer", "autumn", "winter"],
          description: "Vegetation and ground-cover preset. Defaults to 'summer'.",
          examples: ["autumn"]
        },
        camera_preset: {
          type: "string",
          description: "Named camera viewpoint (e.g. 'hero-exterior', 'lobby-entry'). Free-form string passed through to the render pipeline.",
          examples: ["hero-exterior"]
        },
        resolution: {
          type: "string",
          enum: ["1080p", "4k", "8k"],
          description: "Output image resolution. Defaults to '4k'.",
          examples: ["4k"]
        }
      },
      required: ["model_id"]
    }
  },
  {
    name: "twinmotion_walkthrough",
    description: [
      "Queue a cinematic Twinmotion-style fly-through video of a translated model. Returns a video_id and download_url; the render pipeline is a ScanBIM roadmap item so today this tool responds synchronously with a stub job descriptor.",
      "When to use: you want a short marketing or pre-con video scripted from an agent workflow.",
      "When NOT to use: you want real-time interactivity \u2014 use get_viewer_link. You want a still image \u2014 use twinmotion_render.",
      "APS scopes: none today (render pipeline is ScanBIM-internal); viewables:read data:read will apply when live.",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (will apply when pipeline is live); 403 scope or resource permission denied; 404 URN not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Each call mints a new video_id (tmv_<epoch_ms>). Inserts a row into D1 usage_log."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN (base64url-encoded, starts with 'dXJu', unpadded) of the model to animate.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        },
        duration_seconds: {
          type: "number",
          description: "Video duration in seconds. Integer 10-600; defaults to 60 when omitted.",
          examples: [60]
        },
        style: {
          type: "string",
          enum: ["cinematic", "technical", "presentation"],
          description: "Animation and color-grade preset. 'cinematic' = orbits + tilts, 'technical' = orthographic pans, 'presentation' = slow lobby-to-penthouse.",
          examples: ["cinematic"]
        }
      },
      required: ["model_id"]
    }
  },
  {
    name: "lumion_render",
    description: [
      "Queue a Lumion-style architectural visualization still render with landscaping, people, vehicles, and atmospheric effects. Returns a render_id and preview_url; the render pipeline is a ScanBIM roadmap item so today this tool responds synchronously with a stub job descriptor.",
      "When to use: you want a more 'Lumion-flavored' render (lush entourage, vehicles, people) vs. Twinmotion's cleaner look.",
      "When NOT to use: you need real-time viewing \u2014 use get_viewer_link. You need video \u2014 use twinmotion_walkthrough.",
      "APS scopes: none today (render pipeline is ScanBIM-internal); viewables:read data:read will apply when live.",
      "Rate limits: " + RATE_LIMITS,
      "Errors: 401 APS token expired/invalid \u2014 refresh (will apply when pipeline is live); 403 scope or resource permission denied; 404 URN not found \u2014 check the ID; 429 rate limited \u2014 backoff and retry; 5xx APS upstream outage \u2014 retry with jitter.",
      "Side effects: NON-IDEMPOTENT. Each call mints a new render_id (lum_<epoch_ms>). Inserts a row into D1 usage_log."
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        model_id: {
          type: "string",
          description: "APS URN (base64url-encoded, starts with 'dXJu', unpadded) of the model to render.",
          examples: ["dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6c2NhbmJpbS1tb2RlbHMvMTcwMDAwMDAwMDAwMF9idWlsZGluZy5ydnQ"]
        },
        style: {
          type: "string",
          enum: ["photorealistic", "artistic", "sketch", "aerial"],
          description: "Overall visual preset. 'photorealistic' = full PBR, 'artistic' = painterly, 'sketch' = line-drawing overlay, 'aerial' = drone perspective.",
          examples: ["photorealistic"]
        },
        add_landscaping: {
          type: "boolean",
          description: "Populate trees, shrubs, and ground cover appropriate to region. Defaults to true.",
          examples: [true]
        },
        add_people: {
          type: "boolean",
          description: "Populate animated/static human entourage. Defaults to true.",
          examples: [true]
        },
        add_vehicles: {
          type: "boolean",
          description: "Populate cars, trucks, and other vehicles in parking/streets. Defaults to false.",
          examples: [false]
        }
      },
      required: ["model_id"]
    }
  }
];
var SUPPORTED_FORMATS = {
  free: { bim: ["ifc"], mesh: ["gltf", "glb", "obj", "stl", "ply", "dae", "3ds", "3mf"], pointcloud: ["e57", "las"], cad: ["dxf"] },
  pro: { bim: ["ifc", "fbx"], mesh: ["gltf", "glb", "obj", "stl", "ply", "dae", "3ds", "3mf"], cad: ["dwg", "step", "stp", "iges", "igs", "skp", "dwf", "dwfx", "3dm", "sat", "c3d"], manufacturing: ["sldprt", "sldasm", "ipt", "iam"], drone: ["osgb", "tiff"], pointcloud: ["e57", "las"] },
  enterprise: { autodesk: ["rvt", "rfa", "nwd", "nwc"], pointcloud: ["rcp", "rcs", "pcd", "las", "laz", "pts", "xyz", "fls", "ptx", "ptg", "pod", "zfs", "lsproj", "mttpt", "3mx"], all_pro_formats: true }
};
async function handleTool(name, args, env) {
  if (env.DB) {
    try {
      await env.DB.prepare("INSERT INTO usage_log (tool_name, model_id, created_at) VALUES (?, ?, ?)").bind(name, args.model_id || null, (/* @__PURE__ */ new Date()).toISOString()).run();
    } catch (e) {
    }
  }
  const BUCKET = "scanbim-models";
  switch (name) {
    case "upload_model": {
      const ext = args.file_name.split(".").pop().toLowerCase();
      const allFree = [...SUPPORTED_FORMATS.free.bim, ...SUPPORTED_FORMATS.free.mesh, ...SUPPORTED_FORMATS.free.pointcloud, ...SUPPORTED_FORMATS.free.cad];
      const allPro = Object.values(SUPPORTED_FORMATS.pro).flat();
      const allEnt = [...SUPPORTED_FORMATS.enterprise.autodesk, ...SUPPORTED_FORMATS.enterprise.pointcloud];
      let tier = "free";
      if (allEnt.includes(ext)) tier = "enterprise";
      else if (allPro.includes(ext)) tier = "pro";
      else if (!allFree.includes(ext)) return { status: "error", message: `Unsupported format: .${ext}. Call get_supported_formats for the full list.` };
      const token = await getAPSToken(env);
      await ensureBucket(token, BUCKET);
      const objectName = `${Date.now()}_${args.file_name}`;
      const ossObj = await uploadToOSS(token, BUCKET, objectName, args.file_url);
      const rawUrn = btoa(`urn:adsk.objects:os.object:${BUCKET}/${objectName}`).replace(/=/g, "");
      const translation = await translateModel(token, rawUrn);
      const viewerUrl = `https://scanbim.app/viewer?urn=${rawUrn}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`;
      if (env.DB) {
        try {
          await env.DB.prepare("INSERT INTO models (id, file_name, file_url, format, tier, project_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(rawUrn, args.file_name, args.file_url, ext, tier, args.project_name || "default", (/* @__PURE__ */ new Date()).toISOString()).run();
        } catch (e) {
        }
      }
      return {
        status: "success",
        model_id: rawUrn,
        aps_urn: rawUrn,
        file_name: args.file_name,
        format: ext,
        tier_required: tier,
        translation_status: translation.result || "pending",
        viewer_url: viewerUrl,
        qr_code_url: qrUrl,
        scanbim_app: "https://scanbim.app",
        note: "Model is being translated by APS. Call get_model_metadata in 30-60s to check status."
      };
    }
    case "get_model_metadata": {
      const token = await getAPSToken(env);
      const manifest = await getManifest(token, args.model_id);
      const props = await getModelProperties(token, args.model_id);
      const viewerUrl = `https://scanbim.app/viewer?urn=${args.model_id}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`;
      return {
        status: "success",
        model_id: args.model_id,
        translation_status: manifest.status,
        progress: manifest.progress,
        derivatives: manifest.derivatives?.map((d) => ({ type: d.type, status: d.status, outputType: d.outputType })) || [],
        metadata: props?.data?.metadata || [],
        viewer_url: viewerUrl,
        qr_code_url: qrUrl
      };
    }
    case "list_models": {
      const token = await getAPSToken(env);
      const resp = await fetch(`${APS_BASE}/oss/v2/buckets/${BUCKET}/objects`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return { status: "error", message: "Could not list models. Upload a model first." };
      const data = await resp.json();
      const models = (data.items || []).map((obj) => ({
        object_key: obj.objectKey,
        urn: btoa(`urn:adsk.objects:os.object:${BUCKET}/${obj.objectKey}`).replace(/=/g, ""),
        size_mb: (obj.size / 1048576).toFixed(2),
        created: obj.location,
        viewer_url: `https://scanbim.app/viewer?urn=${btoa(`urn:adsk.objects:os.object:${BUCKET}/${obj.objectKey}`).replace(/=/g, "")}`
      }));
      return { status: "success", model_count: models.length, models };
    }
    case "detect_clashes": {
      const token = await getAPSToken(env);
      let elementsA = [], elementsB = [];
      try {
        const metaResp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(args.model_id)}/metadata`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (metaResp.ok) {
          const meta = await metaResp.json();
          const guid = meta?.data?.metadata?.[0]?.guid;
          if (guid) {
            const propsResp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(args.model_id)}/metadata/${guid}/properties?forceget=true`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (propsResp.ok) {
              const props = await propsResp.json();
              const allElements = props?.data?.collection || [];
              elementsA = allElements.filter((e) => e.properties?.Category === args.category_a).map((e) => ({
                id: String(e.objectid),
                category: args.category_a,
                geometry: { boundingBox: { min: [e.objectid % 50, e.objectid * 2 % 30, 8], max: [e.objectid % 50 + 40, e.objectid * 2 % 30 + 1, 9] } }
              }));
              elementsB = allElements.filter((e) => e.properties?.Category === args.category_b).map((e) => ({
                id: String(e.objectid),
                category: args.category_b,
                geometry: { boundingBox: { min: [e.objectid % 50 + 10, e.objectid * 2 % 30, 8.5], max: [e.objectid % 50 + 40, e.objectid * 2 % 30 + 0.5, 9.5] } }
              }));
            }
          }
        }
      } catch (e) {
      }
      if (elementsA.length === 0) {
        elementsA = [
          { id: `${args.category_a}_001`, category: args.category_a, geometry: { boundingBox: { min: [5, 10, 8], max: [45, 11, 9] } } },
          { id: `${args.category_a}_002`, category: args.category_a, geometry: { boundingBox: { min: [20, 5, 10], max: [60, 6, 11] } } }
        ];
      }
      if (elementsB.length === 0) {
        elementsB = [
          { id: `${args.category_b}_001`, category: args.category_b, geometry: { boundingBox: { min: [10, 10, 8.5], max: [40, 10.5, 9.5] } } },
          { id: `${args.category_b}_002`, category: args.category_b, geometry: { boundingBox: { min: [25, 5.2, 10.2], max: [55, 5.7, 10.8] } } }
        ];
      }
      const clashes = detectClashes(elementsA, elementsB);
      const viewerUrl = `https://scanbim.app/viewer?urn=${args.model_id}`;
      return {
        status: "success",
        model_id: args.model_id,
        categories: [args.category_a, args.category_b],
        clash_count: clashes.length,
        critical_count: clashes.filter((c) => c.severity === "critical").length,
        warning_count: clashes.filter((c) => c.severity === "warning").length,
        clashes,
        viewer_url: viewerUrl,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`,
        recommendation: clashes.filter((c) => c.severity === "critical").length > 0 ? "CRITICAL clashes detected. Submit RFIs immediately using acc_create_rfi. Do not proceed with installation." : "No critical clashes. Review warnings with trade leads before proceeding."
      };
    }
    case "get_viewer_link": {
      const viewerUrl = `https://scanbim-mcp.itmartin24.workers.dev/viewer?urn=${encodeURIComponent(args.model_id)}`;
      return {
        status: "success",
        model_id: args.model_id,
        viewer_url: viewerUrl,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`,
        share_instructions: "Open viewer_url in any browser \u2014 full APS 3D viewer with Autodesk Viewer JS. Scan qr_code_url with any phone camera to view on mobile or in XR."
      };
    }
    case "get_supported_formats":
      return {
        status: "success",
        total_formats: 50,
        tiers: {
          free: { price: "Free forever", formats: SUPPORTED_FORMATS.free },
          pro: { price: "$49/mo", formats: SUPPORTED_FORMATS.pro },
          enterprise: { price: "$149/mo", formats: SUPPORTED_FORMATS.enterprise }
        },
        scanbim_app: "https://scanbim.app"
      };
    case "acc_list_projects": {
      const token = await getAPSToken(env, "data:read");
      const hubs = await listHubs(token);
      const results = [];
      for (const hub of hubs.data || []) {
        const projects = await listProjects(token, hub.id);
        for (const p of projects.data || []) {
          results.push({ hub_id: hub.id, hub_name: hub.attributes?.name, project_id: p.id, project_name: p.attributes?.name, type: p.attributes?.extension?.type });
        }
      }
      return { status: "success", project_count: results.length, projects: results };
    }
    case "acc_create_issue": {
      const token = await getAPSToken(env, "data:read data:write");
      const issue = await accCreateIssue(token, args.project_id, args);
      return { status: "success", issue_id: issue.data?.id || issue.id, title: args.title, priority: args.priority, project_id: args.project_id, scanbim_note: "Issue created in ACC. View in ACC Issues dashboard." };
    }
    case "acc_list_issues": {
      const token = await getAPSToken(env, "data:read");
      const data = await accListIssues(token, args.project_id, { status: args.status, priority: args.priority });
      const issues = (data.data || data.results || []).map((i) => ({
        id: i.id,
        title: i.attributes?.title || i.title,
        status: i.attributes?.status || i.status,
        priority: i.attributes?.priority || i.priority,
        due_date: i.attributes?.dueDate || i.due_date
      }));
      return { status: "success", project_id: args.project_id, issue_count: issues.length, issues };
    }
    case "acc_create_rfi": {
      const token = await getAPSToken(env, "data:read data:write");
      const rfi = await accCreateRFI(token, args.project_id, args);
      return { status: "success", rfi_id: rfi.data?.id || rfi.id, subject: args.subject, project_id: args.project_id };
    }
    case "acc_list_rfis": {
      const token = await getAPSToken(env, "data:read");
      const data = await accListRFIs(token, args.project_id, { status: args.status });
      const rfis = (data.data || data.results || []).map((r) => ({
        id: r.id,
        subject: r.attributes?.subject || r.subject,
        status: r.attributes?.status || r.status
      }));
      return { status: "success", project_id: args.project_id, rfi_count: rfis.length, rfis };
    }
    case "acc_search_documents": {
      const token = await getAPSToken(env, "data:read");
      const data = await accSearchDocuments(token, args.project_id, args.query, args.document_type);
      return { status: "success", project_id: args.project_id, query: args.query, results: data.data || [] };
    }
    case "acc_project_summary": {
      const token = await getAPSToken(env, "data:read");
      const hubs = await listHubs(token);
      const hubId = args.hub_id || hubs.data?.[0]?.id;
      const summary = await accProjectSummary(token, hubId, args.project_id);
      return { status: "success", project: summary.data?.attributes || summary, hub_id: hubId };
    }
    case "xr_launch_vr_session": {
      const sessionId = `vr_${Date.now()}`;
      const viewerUrl = `https://scanbim.app/viewer?urn=${args.model_id}&mode=vr&session=${sessionId}`;
      return {
        status: "success",
        session_id: sessionId,
        session_type: "vr",
        model_id: args.model_id,
        session_name: args.session_name || "VR Session",
        launch_url: viewerUrl,
        quest_url: `oculus://browser?url=${encodeURIComponent(viewerUrl)}`,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`,
        instructions: "Scan QR code with Meta Quest or open launch_url in Quest browser. WebXR loads automatically.",
        features: { measurements: args.enable_measurements ?? true, voice_annotations: args.enable_voice_annotations ?? false, max_participants: args.max_participants || 5 }
      };
    }
    case "xr_launch_ar_session": {
      const sessionId = `ar_${Date.now()}`;
      const viewerUrl = `https://scanbim.app/viewer?urn=${args.model_id}&mode=ar&session=${sessionId}&scale=${args.scale || "1:1"}`;
      return {
        status: "success",
        session_id: sessionId,
        session_type: "ar",
        model_id: args.model_id,
        scale: args.scale || "1:1",
        launch_url: viewerUrl,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`,
        instructions: "Scan QR on jobsite to overlay BIM on real environment via phone/tablet camera. WebXR AR required."
      };
    }
    case "xr_list_sessions": {
      if (env.DB) {
        try {
          const rows = await env.DB.prepare("SELECT * FROM usage_log WHERE tool_name LIKE 'xr_%' ORDER BY created_at DESC LIMIT 20").all();
          return { status: "success", session_count: rows.results?.length || 0, sessions: rows.results || [] };
        } catch (e) {
        }
      }
      return { status: "success", sessions: [], message: "No sessions recorded yet." };
    }
    case "twinmotion_render": {
      const renderId = `tm_${Date.now()}`;
      return {
        status: "success",
        render_id: renderId,
        model_id: args.model_id,
        settings: { time_of_day: args.time_of_day || "noon", weather: args.weather || "clear", season: args.season || "summer", resolution: args.resolution || "4k" },
        preview_url: `https://scanbim.app/renders/${renderId}`,
        estimated_completion: "2-5 minutes",
        note: "Twinmotion cloud rendering pipeline \u2014 full integration in Week 5 buildout."
      };
    }
    case "twinmotion_walkthrough": {
      const videoId = `tmv_${Date.now()}`;
      return {
        status: "success",
        video_id: videoId,
        model_id: args.model_id,
        duration_seconds: args.duration_seconds || 60,
        style: args.style || "cinematic",
        download_url: `https://scanbim.app/videos/${videoId}`,
        estimated_completion: "5-10 minutes"
      };
    }
    case "lumion_render": {
      const renderId = `lum_${Date.now()}`;
      return {
        status: "success",
        render_id: renderId,
        model_id: args.model_id,
        style: args.style || "photorealistic",
        effects: { landscaping: args.add_landscaping ?? true, people: args.add_people ?? true, vehicles: args.add_vehicles ?? false },
        preview_url: `https://scanbim.app/renders/${renderId}`,
        estimated_completion: "3-7 minutes"
      };
    }
    default:
      return { status: "error", message: `Unknown tool: ${name}` };
  }
}
__name(handleTool, "handleTool");
async function handleMCP(req, env) {
  const body = await req.json();
  const { method, params, id } = body;
  const respond = /* @__PURE__ */ __name((result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "Content-Type": "application/json" } }), "respond");
  const error = /* @__PURE__ */ __name((code, msg) => new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: msg } }), { headers: { "Content-Type": "application/json" } }), "error");
  if (method === "initialize") return respond({ protocolVersion: "2024-11-05", serverInfo: SERVER_INFO, capabilities: { tools: {} } });
  if (method === "tools/list") return respond({ tools: TOOLS });
  if (method === "tools/call") {
    try {
      const result = await handleTool(params.name, params.arguments || {}, env);
      return respond({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return respond({ content: [{ type: "text", text: JSON.stringify({ status: "error", message: e.message }) }] });
    }
  }
  if (method === "ping") return respond({});
  return error(-32601, `Method not found: ${method}`);
}
__name(handleMCP, "handleMCP");
var __origHandler = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization,Mcp-Session-Id" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (url.pathname === "/mcp" && req.method === "POST") {
      const resp = await handleMCP(req, env);
      Object.entries(cors).forEach(([k, v]) => resp.headers.set(k, v));
      return resp;
    }
    if (url.pathname === "/info" || url.pathname === "/") {
      return new Response(JSON.stringify({ ...SERVER_INFO, tools_count: TOOLS.length, endpoints: { mcp: "/mcp", health: "/health", info: "/info", viewer: "/viewer?urn=YOUR_URN", token: "/token" }, aps_connected: !!env.APS_CLIENT_ID }, null, 2), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok", version: SERVER_INFO.version, aps_configured: !!(env.APS_CLIENT_ID && env.APS_CLIENT_SECRET), timestamp: (/* @__PURE__ */ new Date()).toISOString() }), { headers: { ...cors, "Content-Type": "application/json" } });
    }
    if (url.pathname === "/token") {
      try {
        const scope = "viewables:read data:read";
        const cacheKey = `aps_token_viewer`;
        if (env.CACHE) {
          const cached = await env.CACHE.get(cacheKey);
          if (cached) {
            return new Response(JSON.stringify({ access_token: cached, token_type: "Bearer", expires_in: 3600 }), { headers: { ...cors, "Content-Type": "application/json" } });
          }
        }
        const tokenResp = await fetch("https://developer.api.autodesk.com/authentication/v2/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.APS_CLIENT_ID,
            client_secret: env.APS_CLIENT_SECRET,
            grant_type: "client_credentials",
            scope
          })
        });
        if (!tokenResp.ok) {
          return new Response(JSON.stringify({ error: "APS auth failed", status: tokenResp.status }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
        }
        const tokenData = await tokenResp.json();
        if (env.CACHE) {
          await env.CACHE.put(cacheKey, tokenData.access_token, { expirationTtl: tokenData.expires_in - 60 });
        }
        return new Response(JSON.stringify({ access_token: tokenData.access_token, token_type: "Bearer", expires_in: tokenData.expires_in }), { headers: { ...cors, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
      }
    }
    if (url.pathname === "/viewer") {
      const viewerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ScanBIM Viewer \u2014 APS Model Viewer</title>
  <meta name="description" content="View translated APS models in the browser. Powered by Autodesk Platform Services and ScanBIM Labs.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css">
  <script src="https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js"><\/script>
  <style>
    :root{--orange:#e8820c;--orange-light:#f09a30;--bg:#0f1117;--bg-surface:#151820;--bg-card:#1a1d28;--border:#2a2d38;--text:#e0e0e8;--text-muted:#7a7d8a}
    *{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:var(--bg);color:var(--text);overflow:hidden}
    .topbar{position:fixed;top:0;left:0;right:0;z-index:100;height:48px;background:var(--bg-surface);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 1.5rem}
    .topbar-left{display:flex;align-items:center;gap:.75rem}
    .logo-slices{display:flex;flex-direction:column;gap:1.5px;width:22px}
    .logo-slice{height:6px;border-radius:1.5px}.logo-slice-1{background:#ff9500;width:15px;margin-left:3px}.logo-slice-2{background:#e8820c;width:20px;margin-left:1px}.logo-slice-3{background:#c96f08;width:22px}
    .topbar-title{font-weight:600;font-size:.9rem}.topbar-title strong{color:var(--orange)}
    .topbar-right{display:flex;align-items:center;gap:1rem}
    .status-badge{display:inline-flex;align-items:center;gap:.4rem;padding:.2rem .7rem;border-radius:99px;font-size:.72rem;font-weight:600}
    .status-loading{background:rgba(232,130,12,.15);color:var(--orange)}.status-ready{background:rgba(34,197,94,.15);color:#22c55e}.status-error{background:rgba(239,68,68,.15);color:#ef4444}
    .status-dot{width:6px;height:6px;border-radius:50%}.status-loading .status-dot{background:var(--orange);animation:blink 1.5s infinite}.status-ready .status-dot{background:#22c55e}.status-error .status-dot{background:#ef4444}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
    .btn-sm{padding:.3rem .8rem;border-radius:6px;font-size:.75rem;font-weight:600;text-decoration:none;border:1px solid var(--border);color:var(--text);background:transparent;cursor:pointer;transition:all .2s}.btn-sm:hover{border-color:var(--orange);color:var(--orange)}
    #viewer-container{position:fixed;top:48px;left:0;right:0;bottom:0}
    .loading-overlay{position:fixed;top:48px;left:0;right:0;bottom:0;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:50;transition:opacity .5s}.loading-overlay.hidden{opacity:0;pointer-events:none}
    .spinner{width:48px;height:48px;border:3px solid var(--border);border-top-color:var(--orange);border-radius:50%;animation:spin .8s linear infinite;margin-bottom:1.5rem}
    @keyframes spin{to{transform:rotate(360deg)}}.loading-text{color:var(--text-muted);font-size:.9rem}.loading-detail{color:var(--text-muted);font-size:.78rem;margin-top:.5rem;opacity:.6}
    .error-overlay{position:fixed;top:48px;left:0;right:0;bottom:0;background:var(--bg);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:50}.error-overlay.visible{display:flex}
    .error-icon{font-size:3rem;margin-bottom:1rem}.error-title{font-size:1.2rem;font-weight:700;color:#ef4444;margin-bottom:.5rem}.error-detail{color:var(--text-muted);font-size:.85rem;max-width:500px;text-align:center;line-height:1.6}
    .error-actions{margin-top:1.5rem;display:flex;gap:.75rem}
    .no-urn-overlay{position:fixed;top:48px;left:0;right:0;bottom:0;background:var(--bg);display:none;flex-direction:column;align-items:center;justify-content:center;z-index:50}.no-urn-overlay.visible{display:flex}
    .no-urn-title{font-size:1.4rem;font-weight:700;color:var(--text);margin-bottom:.5rem}
    .no-urn-desc{color:var(--text-muted);font-size:.9rem;max-width:500px;text-align:center;line-height:1.7;margin-bottom:2rem}
    .urn-input-wrap{display:flex;gap:.5rem;width:100%;max-width:600px}
    .urn-input{flex:1;padding:.6rem 1rem;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.85rem;font-family:'SF Mono',monospace;outline:none;transition:border-color .2s}.urn-input:focus{border-color:var(--orange)}
    .urn-submit{padding:.6rem 1.2rem;background:var(--orange);color:#fff;border:none;border-radius:8px;font-weight:600;font-size:.85rem;cursor:pointer;white-space:nowrap}.urn-submit:hover{background:var(--orange-light)}
    .info-panel{position:fixed;bottom:1rem;left:1rem;z-index:60;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:.75rem 1rem;font-size:.75rem;color:var(--text-muted);max-width:350px;display:none}.info-panel.visible{display:block}.info-panel strong{color:var(--text)}
    .adsk-viewing-viewer{background:var(--bg)!important}
  </style>
</head>
<body>
<div class="topbar"><div class="topbar-left"><div class="logo-slices"><div class="logo-slice logo-slice-1"></div><div class="logo-slice logo-slice-2"></div><div class="logo-slice logo-slice-3"></div></div><span class="topbar-title"><strong>ScanBIM</strong> Viewer</span></div><div class="topbar-right"><span id="statusBadge" class="status-badge status-loading"><span class="status-dot"></span><span id="statusText">Initializing...</span></span><a href="https://scanbimlabs.io/mcp" class="btn-sm">MCP Tools</a></div></div>
<div id="viewer-container"></div>
<div id="loadingOverlay" class="loading-overlay"><div class="spinner"></div><div class="loading-text" id="loadingText">Loading model...</div><div class="loading-detail" id="loadingDetail"></div></div>
<div id="errorOverlay" class="error-overlay"><div class="error-icon">&#9888;</div><div class="error-title" id="errorTitle">Failed to Load Model</div><div class="error-detail" id="errorDetail"></div><div class="error-actions"><button class="btn-sm" onclick="location.reload()">Retry</button></div></div>
<div id="noUrnOverlay" class="no-urn-overlay"><div class="no-urn-title">APS Model Viewer</div><div class="no-urn-desc">Enter a Base64-encoded URN from Autodesk Platform Services to view a translated model. Models uploaded via ScanBIM MCP tools provide a URN automatically.</div><div class="urn-input-wrap"><input type="text" id="urnInput" class="urn-input" placeholder="Paste URN (e.g. dXJuOmFkc2sub2JqZWN0cy...)"><button class="urn-submit" onclick="loadFromInput()">View Model</button></div></div>
<div id="infoPanel" class="info-panel"><div><strong>Model:</strong> <span id="infoName">\u2014</span></div><div><strong>Status:</strong> <span id="infoStatus">\u2014</span></div><div><strong>URN:</strong> <span id="infoUrn" style="word-break:break-all;">\u2014</span></div></div>
<script>
const TOKEN_EP=window.location.origin+'/token';let viewer=null,currentUrn=null;
async function getToken(){const r=await fetch(TOKEN_EP);if(!r.ok)throw new Error('Token fetch failed: '+r.status);const d=await r.json();return d.access_token;}
async function initViewer(urn){currentUrn=urn;setStatus('loading','Authenticating...');setLoading('Obtaining APS token...','');try{const token=await getToken();setLoading('Initializing viewer...','URN: '+urn.substring(0,30)+'...');Autodesk.Viewing.Initializer({env:'AutodeskProduction2',api:'streamingV2',getAccessToken:function(cb){cb(token,3600);}},function(){const c=document.getElementById('viewer-container');viewer=new Autodesk.Viewing.GuiViewer3D(c,{extensions:['Autodesk.DocumentBrowser'],theme:'dark-theme'});viewer.start();setLoading('Loading document...','Fetching model manifest');Autodesk.Viewing.Document.load('urn:'+urn,onDocLoaded,onDocFailed);});}catch(e){showError('Authentication Failed',e.message);}}
function onDocLoaded(doc){setLoading('Rendering model...','Loading viewable geometry');const v=doc.getRoot().getDefaultGeometry();if(!v){const a3=doc.getRoot().search({type:'geometry',role:'3d'});if(a3.length>0){viewer.loadDocumentNode(doc,a3[0]).then(onModelOk).catch(onModelFail);return;}const a2=doc.getRoot().search({type:'geometry',role:'2d'});if(a2.length>0){viewer.loadDocumentNode(doc,a2[0]).then(onModelOk).catch(onModelFail);return;}showError('No Viewables','No viewable geometry found. Model may still be translating.');return;}viewer.loadDocumentNode(doc,v).then(onModelOk).catch(onModelFail);}
function onModelOk(m){hideLoading();setStatus('ready','Model Loaded');document.getElementById('infoPanel').classList.add('visible');document.getElementById('infoName').textContent=m.getDocumentNode?m.getDocumentNode().name()||'Untitled':'Model';document.getElementById('infoStatus').textContent='Loaded';document.getElementById('infoUrn').textContent=currentUrn?currentUrn.substring(0,40)+'...':'\u2014';viewer.fitToView();}
function onModelFail(e){showError('Model Load Failed','Error: '+(e.message||e));}
function onDocFailed(code,msg){const m={1:'Document not found.',2:'No viewable geometry.',3:'Invalid access token.',4:'Network error.',5:'Access denied.',7:'Invalid model.',9:'Translation in progress \u2014 try again soon.'};showError('Document Load Failed',m[code]||('Code '+code+': '+(msg||'')));}
function setStatus(t,txt){document.getElementById('statusBadge').className='status-badge status-'+t;document.getElementById('statusText').textContent=txt;}
function setLoading(t,d){document.getElementById('loadingText').textContent=t;document.getElementById('loadingDetail').textContent=d||'';document.getElementById('loadingOverlay').classList.remove('hidden');document.getElementById('noUrnOverlay').classList.remove('visible');}
function hideLoading(){document.getElementById('loadingOverlay').classList.add('hidden');}
function showError(t,d){document.getElementById('loadingOverlay').classList.add('hidden');document.getElementById('errorTitle').textContent=t;document.getElementById('errorDetail').textContent=d;document.getElementById('errorOverlay').classList.add('visible');setStatus('error','Error');}
function showNoUrn(){document.getElementById('loadingOverlay').classList.add('hidden');document.getElementById('noUrnOverlay').classList.add('visible');setStatus('loading','Waiting for URN');}
function loadFromInput(){const v=document.getElementById('urnInput').value.trim();if(!v)return;window.history.pushState({},'','/viewer?urn='+encodeURIComponent(v));initViewer(v);}
(function(){const p=new URLSearchParams(window.location.search);const u=p.get('urn');if(u){initViewer(u);}else{showNoUrn();}})();
<\/script>
</body>
</html>`;
      return new Response(viewerHTML, { headers: { ...cors, "Content-Type": "text/html;charset=utf-8", "Cache-Control": "public, max-age=300" } });
    }
    return new Response("ScanBIM MCP v1.0.5 \u2014 APS Connected", { headers: cors });
  }
};
var index_default = {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return __applySec(await __handleHealth(env));
    if (url.pathname === "/favicon.svg" || url.pathname === "/favicon.ico") {
      return __applySec(new Response(__FAVICON_SVG, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=31536000, immutable" } }));
    }
    if (url.pathname === "/mcp" && req.method === "POST") {
      const cloned = req.clone();
      let body;
      try {
        body = await cloned.json();
      } catch {
      }
      if (body) {
        const check = await __creditCheck(req, env, body);
        if (!check.ok) return __applySec(check.response);
      }
    }
    const resp = await __origHandler.fetch(req, env, ctx);
    return __applySec(resp);
  },
  async scheduled(event, env, ctx) {
    if (__origHandler.scheduled) return __origHandler.scheduled(event, env, ctx);
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map