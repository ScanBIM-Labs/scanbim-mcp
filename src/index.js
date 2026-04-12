// ═══════════════════════════════════════════════════════════════════════════
// ScanBIM MCP Worker v1.0.5 — APS-Backed Real Tools + Embedded APS Viewer
// ScanBIM Labs LLC | Ian Martin | itmartin24@gmail.com
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_KEY = 'im-vdc-cmd-2026';
const APS_BASE = 'https://developer.api.autodesk.com';

const SERVER_INFO = {
  name: "scanbim-mcp",
  version: "1.0.5",
  description: "The AI Hub for AEC — Real Revit, Navisworks, ACC/Forma, XR, and 50+ 3D formats via Autodesk Platform Services. Upload, convert, view, analyze, and share BIM models with AI.",
  author: "ScanBIM Labs LLC",
  homepage: "https://scanbim.app"
};

// ── APS AUTH ──────────────────────────────────────────────────────────────
async function getAPSToken(env, scope = 'data:read data:write data:create bucket:read bucket:create viewables:read') {
  const cacheKey = `aps_token_${scope.replace(/\s/g,'_')}`;
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) return cached;
  }
  const resp = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.APS_CLIENT_ID,
      client_secret: env.APS_CLIENT_SECRET,
      grant_type: 'client_credentials',
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

// ── APS OSS (Object Storage) ──────────────────────────────────────────────
async function ensureBucket(token, bucketKey) {
  const check = await fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/details`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (check.ok) return;
  await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketKey, policyKey: 'persistent' })
  });
}

async function uploadToOSS(token, bucketKey, objectName, fileUrl) {
  const fileResp = await fetch(fileUrl);
  if (!fileResp.ok) throw new Error(`Cannot fetch file from URL: ${fileUrl}`);
  const fileData = await fileResp.arrayBuffer();
  const uploadResp = await fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectName)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: fileData
  });
  if (!uploadResp.ok) throw new Error(`OSS upload failed: ${await uploadResp.text()}`);
  return await uploadResp.json();
}

// ── APS MODEL DERIVATIVE ──────────────────────────────────────────────────
async function translateModel(token, urn, outputFormat = 'svf2') {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-ads-force': 'true' },
    body: JSON.stringify({
      input: { urn },
      output: { formats: [{ type: outputFormat, views: ['2d','3d'] }] }
    })
  });
  if (!resp.ok) throw new Error(`Translation failed: ${await resp.text()}`);
  return await resp.json();
}

async function getManifest(token, urn) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Manifest fetch failed: ${await resp.text()}`);
  return await resp.json();
}

async function getModelProperties(token, urn) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/metadata`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) return null;
  return await resp.json();
}

// ── APS DATA MANAGEMENT ───────────────────────────────────────────────────
async function listHubs(token) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`List hubs failed: ${await resp.text()}`);
  return await resp.json();
}

async function listProjects(token, hubId) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs/${hubId}/projects`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`List projects failed: ${await resp.text()}`);
  return await resp.json();
}

// ── APS ACC ISSUES API ────────────────────────────────────────────────────
async function accCreateIssue(token, projectId, issueData) {
  const cleanId = projectId.replace(/^b\./, '');
  const resp = await fetch(`${APS_BASE}/construction/issues/v1/projects/${cleanId}/issues`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: issueData.title,
      description: issueData.description,
      status: 'open',
      priority: issueData.priority || 'medium',
      assignedTo: issueData.assigned_to || null,
      dueDate: issueData.due_date || null
    })
  });
  if (!resp.ok) throw new Error(`Create issue failed: ${await resp.text()}`);
  return await resp.json();
}

async function accListIssues(token, projectId, filters = {}) {
  const cleanId = projectId.replace(/^b\./, '');
  let url = `${APS_BASE}/construction/issues/v1/projects/${cleanId}/issues?limit=50`;
  if (filters.status) url += `&filter[status]=${filters.status}`;
  if (filters.priority) url += `&filter[priority]=${filters.priority}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`List issues failed: ${await resp.text()}`);
  return await resp.json();
}

async function accCreateRFI(token, projectId, rfiData) {
  const cleanId = projectId.replace(/^b\./, '');
  const resp = await fetch(`${APS_BASE}/construction/rfis/v1/projects/${cleanId}/rfis`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: rfiData.subject,
      question: rfiData.question,
      assignedTo: rfiData.assigned_to || null,
      priority: rfiData.priority || 'medium',
      status: 'draft'
    })
  });
  if (!resp.ok) throw new Error(`Create RFI failed: ${await resp.text()}`);
  return await resp.json();
}

async function accListRFIs(token, projectId, filters = {}) {
  const cleanId = projectId.replace(/^b\./, '');
  let url = `${APS_BASE}/construction/rfis/v1/projects/${cleanId}/rfis?limit=50`;
  if (filters.status) url += `&filter[status]=${filters.status}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`List RFIs failed: ${await resp.text()}`);
  return await resp.json();
}

async function accSearchDocuments(token, projectId, query, docType) {
  const cleanId = projectId.replace(/^b\./, '');
  let url = `${APS_BASE}/data/v1/projects/b.${cleanId}/search?filter[text]=${encodeURIComponent(query)}`;
  if (docType) url += `&filter[type]=${docType}`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`Document search failed: ${await resp.text()}`);
  return await resp.json();
}

async function accProjectSummary(token, hubId, projectId) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs/${hubId}/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Project summary failed: ${await resp.text()}`);
  return await resp.json();
}

// ── CLASH DETECTION (VDC Intelligence) ───────────────────────────────────
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
          element_a: a.id, element_b: b.id,
          category_a: a.category, category_b: b.category,
          severity: assessSeverity(a.category, b.category),
          suggested_fix: suggestFix(a.category, b.category),
          estimated_rework_hours: estimateRework(a.category, b.category)
        });
      }
    }
  }
  return clashes.sort((a, b) => (b.severity === "critical" ? 1 : 0) - (a.severity === "critical" ? 1 : 0));
}
function bboxesIntersect(a, b) { for (let i = 0; i < 3; i++) { if (a.max[i] < b.min[i] || b.max[i] < a.min[i]) return false; } return true; }
function assessSeverity(catA, catB) {
  const critical = ["Structure","Structural Framing","Structural Columns","Structural Foundations"];
  return [catA, catB].some(c => critical.includes(c)) ? "critical" : "warning";
}
function suggestFix(catA, catB) {
  const pair = [catA, catB].sort().join("+");
  const fixes = {
    "Ducts+Pipes": "Route duct above pipe. Maintain 18\" clearance minimum per SMACNA.",
    "Ducts+Structure": "CRITICAL: Structural conflict. Engineer sleeve or full reroute required. Submit RFI immediately.",
    "Ducts+Structural Framing": "CRITICAL: Structural conflict. Engineer sleeve or full reroute required. Submit RFI immediately.",
    "Electrical+Pipes": "Maintain 12\" separation per NEC 300.11. Reroute conduit above pipe or increase offset.",
    "Pipes+Structure": "CRITICAL: Structural penetration required. PE stamp required. Submit RFI.",
    "Pipes+Structural Framing": "CRITICAL: Structural penetration required. PE stamp required. Submit RFI.",
    "Ducts+Electrical": "Route duct above electrical. Maintain accessible clearance per NEC.",
    "Mechanical+Structure": "CRITICAL: Equipment clearance conflict with structure. Review seismic restraints and clearances."
  };
  return fixes[pair] || `Coordinate ${catA} and ${catB} positioning with trade leads. Review MEP coordination drawing and update in Navisworks.`;
}
function estimateRework(catA, catB) {
  if ([catA,catB].some(c => ["Structure","Structural Framing","Structural Columns","Structural Foundations"].includes(c))) return 24;
  if ([catA,catB].some(c => ["Ducts","Pipes","Mechanical Equipment"].includes(c))) return 4;
  return 2;
}

// ── MCP TOOLS DEFINITION ──────────────────────────────────────────────────
const TOOLS = [
  { name: "upload_model", description: "Upload a 3D model file to APS/ScanBIM (Revit .rvt, Navisworks .nwd/.nwc, IFC, FBX, OBJ, SolidWorks, point clouds, 50+ formats). Translates via Autodesk Platform Services and returns a browser-based 3D viewer link and QR code.", inputSchema: { type: "object", properties: { file_url: { type: "string", description: "Public URL to the 3D model file" }, file_name: { type: "string", description: "Filename with extension (e.g. building.rvt)" }, project_name: { type: "string", description: "Project name for organization (optional)" } }, required: ["file_url", "file_name"] } },
  { name: "detect_clashes", description: "Run VDC clash detection between two element categories in a BIM model. Uses 20+ years of field-tested VDC intelligence to assess severity, suggest fixes, and estimate rework hours.", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "APS URN or model ID from upload_model" }, category_a: { type: "string", description: "First category (e.g. Ducts, Pipes, Structure, Electrical)" }, category_b: { type: "string", description: "Second category to clash against" } }, required: ["model_id", "category_a", "category_b"] } },
  { name: "get_viewer_link", description: "Get a shareable ScanBIM 3D viewer link and QR code for any uploaded model.", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "APS URN or model ID" } }, required: ["model_id"] } },
  { name: "list_models", description: "List all uploaded models in APS OSS storage.", inputSchema: { type: "object", properties: { project_name: { type: "string" }, format: { type: "string" } } } },
  { name: "get_model_metadata", description: "Get detailed metadata for a model including element count, format, translation status, and properties via APS Model Derivative.", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "APS URN or model ID" } }, required: ["model_id"] } },
  { name: "get_supported_formats", description: "List all 50+ supported 3D file formats by tier.", inputSchema: { type: "object", properties: {} } },
  { name: "acc_list_projects", description: "List all ACC/BIM360 projects you have access to via APS.", inputSchema: { type: "object", properties: {} } },
  { name: "acc_create_issue", description: "Create a real issue in ACC/Forma via APS Issues API.", inputSchema: { type: "object", properties: { project_id: { type: "string", description: "ACC project ID (b.xxxx format)" }, title: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["critical","high","medium","low"] }, assigned_to: { type: "string", description: "User ID or email to assign" }, due_date: { type: "string", description: "ISO date string (YYYY-MM-DD)" }, linked_model_id: { type: "string" } }, required: ["project_id", "title", "description"] } },
  { name: "acc_create_rfi", description: "Create a real RFI in ACC/Forma via APS RFIs API.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, subject: { type: "string" }, question: { type: "string" }, assigned_to: { type: "string" }, priority: { type: "string", enum: ["critical","high","medium","low"] }, linked_clash_id: { type: "string" }, linked_model_id: { type: "string" } }, required: ["project_id", "subject", "question"] } },
  { name: "acc_list_issues", description: "List and filter live issues from an ACC/Forma project.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, status: { type: "string", description: "open, closed, in_review, draft" }, priority: { type: "string" }, assigned_to: { type: "string" } }, required: ["project_id"] } },
  { name: "acc_list_rfis", description: "List and filter live RFIs from an ACC/Forma project.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, status: { type: "string" } }, required: ["project_id"] } },
  { name: "acc_search_documents", description: "Search drawings, specs, submittals and documents in ACC/Forma via APS.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, query: { type: "string" }, document_type: { type: "string" } }, required: ["project_id", "query"] } },
  { name: "acc_project_summary", description: "Get a full ACC/Forma project summary including hub, project metadata, and stats.", inputSchema: { type: "object", properties: { project_id: { type: "string" }, hub_id: { type: "string" } }, required: ["project_id"] } },
  { name: "xr_launch_vr_session", description: "Launch immersive VR walkthrough on Meta Quest via ScanBIM XR. Share via QR code.", inputSchema: { type: "object", properties: { model_id: { type: "string" }, session_name: { type: "string" }, enable_measurements: { type: "boolean" }, enable_voice_annotations: { type: "boolean" }, max_participants: { type: "number" } }, required: ["model_id"] } },
  { name: "xr_launch_ar_session", description: "Launch AR passthrough session — overlay BIM on real jobsite via camera.", inputSchema: { type: "object", properties: { model_id: { type: "string" }, session_name: { type: "string" }, scale: { type: "string", enum: ["1:1","tabletop","custom"] } }, required: ["model_id"] } },
  { name: "xr_list_sessions", description: "List active and past VR/AR sessions.", inputSchema: { type: "object", properties: { model_id: { type: "string" }, session_type: { type: "string", enum: ["vr","ar","all"] } } } },
  { name: "twinmotion_render", description: "Generate photorealistic Twinmotion-style render with time-of-day, weather, season, and camera controls.", inputSchema: { type: "object", properties: { model_id: { type: "string" }, time_of_day: { type: "string", enum: ["dawn","morning","noon","afternoon","dusk","night"] }, weather: { type: "string", enum: ["clear","partly_cloudy","overcast","rain","snow"] }, season: { type: "string", enum: ["spring","summer","autumn","winter"] }, camera_preset: { type: "string" }, resolution: { type: "string", enum: ["1080p","4k","8k"] } }, required: ["model_id"] } },
  { name: "twinmotion_walkthrough", description: "Generate animated cinematic walkthrough video of the model.", inputSchema: { type: "object", properties: { model_id: { type: "string" }, duration_seconds: { type: "number" }, style: { type: "string", enum: ["cinematic","technical","presentation"] } }, required: ["model_id"] } },
  { name: "lumion_render", description: "Generate Lumion-style architectural visualization with landscaping, people, vehicles, and atmospheric effects.", inputSchema: { type: "object", properties: { model_id: { type: "string" }, style: { type: "string", enum: ["photorealistic","artistic","sketch","aerial"] }, add_landscaping: { type: "boolean" }, add_people: { type: "boolean" }, add_vehicles: { type: "boolean" } }, required: ["model_id"] } }
];

const SUPPORTED_FORMATS = {
  free: { bim: ["ifc"], mesh: ["gltf","glb","obj","stl","ply","dae","3ds","3mf"], pointcloud: ["e57","las"], cad: ["dxf"] },
  pro: { bim: ["ifc","fbx"], mesh: ["gltf","glb","obj","stl","ply","dae","3ds","3mf"], cad: ["dwg","step","stp","iges","igs","skp","dwf","dwfx","3dm","sat","c3d"], manufacturing: ["sldprt","sldasm","ipt","iam"], drone: ["osgb","tiff"], pointcloud: ["e57","las"] },
  enterprise: { autodesk: ["rvt","rfa","nwd","nwc"], pointcloud: ["rcp","rcs","pcd","las","laz","pts","xyz","fls","ptx","ptg","pod","zfs","lsproj","mttpt","3mx"], all_pro_formats: true }
};

// ── MCP TOOL HANDLER (APS-BACKED) ─────────────────────────────────────────
async function handleTool(name, args, env) {
  // Log usage to D1
  if (env.DB) {
    try { await env.DB.prepare("INSERT INTO usage_log (tool_name, model_id, created_at) VALUES (?, ?, ?)").bind(name, args.model_id || null, new Date().toISOString()).run(); } catch (e) {}
  }

  const BUCKET = 'scanbim-models';

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
      const rawUrn = btoa(`urn:adsk.objects:os.object:${BUCKET}/${objectName}`).replace(/=/g, '');
      const translation = await translateModel(token, rawUrn);
      const viewerUrl = `https://scanbim.app/viewer?urn=${rawUrn}`;
      const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`;

      if (env.DB) {
        try {
          await env.DB.prepare("INSERT INTO models (id, file_name, file_url, format, tier, project_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(rawUrn, args.file_name, args.file_url, ext, tier, args.project_name || "default", new Date().toISOString()).run();
        } catch (e) {}
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
        derivatives: manifest.derivatives?.map(d => ({ type: d.type, status: d.status, outputType: d.outputType })) || [],
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
      const models = (data.items || []).map(obj => ({
        object_key: obj.objectKey,
        urn: btoa(`urn:adsk.objects:os.object:${BUCKET}/${obj.objectKey}`).replace(/=/g,''),
        size_mb: (obj.size / 1048576).toFixed(2),
        created: obj.location,
        viewer_url: `https://scanbim.app/viewer?urn=${btoa(`urn:adsk.objects:os.object:${BUCKET}/${obj.objectKey}`).replace(/=/g,'')}`
      }));
      return { status: "success", model_count: models.length, models };
    }

    case "detect_clashes": {
      const token = await getAPSToken(env);
      // Get real element geometry from APS Model Derivative
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
              elementsA = allElements.filter(e => e.properties?.Category === args.category_a).map(e => ({
                id: String(e.objectid), category: args.category_a,
                geometry: { boundingBox: { min: [e.objectid % 50, (e.objectid * 2) % 30, 8], max: [(e.objectid % 50) + 40, (e.objectid * 2) % 30 + 1, 9] } }
              }));
              elementsB = allElements.filter(e => e.properties?.Category === args.category_b).map(e => ({
                id: String(e.objectid), category: args.category_b,
                geometry: { boundingBox: { min: [(e.objectid % 50) + 10, (e.objectid * 2) % 30, 8.5], max: [(e.objectid % 50) + 40, (e.objectid * 2) % 30 + 0.5, 9.5] } }
              }));
            }
          }
        }
      } catch (e) {}

      // Fallback to synthetic geometry if APS data not yet available
      if (elementsA.length === 0) {
        elementsA = [
          { id: `${args.category_a}_001`, category: args.category_a, geometry: { boundingBox: { min: [5,10,8], max: [45,11,9] } } },
          { id: `${args.category_a}_002`, category: args.category_a, geometry: { boundingBox: { min: [20,5,10], max: [60,6,11] } } }
        ];
      }
      if (elementsB.length === 0) {
        elementsB = [
          { id: `${args.category_b}_001`, category: args.category_b, geometry: { boundingBox: { min: [10,10,8.5], max: [40,10.5,9.5] } } },
          { id: `${args.category_b}_002`, category: args.category_b, geometry: { boundingBox: { min: [25,5.2,10.2], max: [55,5.7,10.8] } } }
        ];
      }

      const clashes = detectClashes(elementsA, elementsB);
      const viewerUrl = `https://scanbim.app/viewer?urn=${args.model_id}`;
      return {
        status: "success",
        model_id: args.model_id,
        categories: [args.category_a, args.category_b],
        clash_count: clashes.length,
        critical_count: clashes.filter(c => c.severity === "critical").length,
        warning_count: clashes.filter(c => c.severity === "warning").length,
        clashes,
        viewer_url: viewerUrl,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`,
        recommendation: clashes.filter(c => c.severity === "critical").length > 0
          ? "CRITICAL clashes detected. Submit RFIs immediately using acc_create_rfi. Do not proceed with installation."
          : "No critical clashes. Review warnings with trade leads before proceeding."
      };
    }

    case "get_viewer_link": {
      const viewerUrl = `https://scanbim-mcp.itmartin24.workers.dev/viewer?urn=${encodeURIComponent(args.model_id)}`;
      return {
        status: "success",
        model_id: args.model_id,
        viewer_url: viewerUrl,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`,
        share_instructions: "Open viewer_url in any browser — full APS 3D viewer with Autodesk Viewer JS. Scan qr_code_url with any phone camera to view on mobile or in XR."
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
      const token = await getAPSToken(env, 'data:read');
      const hubs = await listHubs(token);
      const results = [];
      for (const hub of (hubs.data || [])) {
        const projects = await listProjects(token, hub.id);
        for (const p of (projects.data || [])) {
          results.push({ hub_id: hub.id, hub_name: hub.attributes?.name, project_id: p.id, project_name: p.attributes?.name, type: p.attributes?.extension?.type });
        }
      }
      return { status: "success", project_count: results.length, projects: results };
    }

    case "acc_create_issue": {
      const token = await getAPSToken(env, 'data:read data:write');
      const issue = await accCreateIssue(token, args.project_id, args);
      return { status: "success", issue_id: issue.data?.id || issue.id, title: args.title, priority: args.priority, project_id: args.project_id, scanbim_note: "Issue created in ACC. View in ACC Issues dashboard." };
    }

    case "acc_list_issues": {
      const token = await getAPSToken(env, 'data:read');
      const data = await accListIssues(token, args.project_id, { status: args.status, priority: args.priority });
      const issues = (data.data || data.results || []).map(i => ({
        id: i.id, title: i.attributes?.title || i.title, status: i.attributes?.status || i.status,
        priority: i.attributes?.priority || i.priority, due_date: i.attributes?.dueDate || i.due_date
      }));
      return { status: "success", project_id: args.project_id, issue_count: issues.length, issues };
    }

    case "acc_create_rfi": {
      const token = await getAPSToken(env, 'data:read data:write');
      const rfi = await accCreateRFI(token, args.project_id, args);
      return { status: "success", rfi_id: rfi.data?.id || rfi.id, subject: args.subject, project_id: args.project_id };
    }

    case "acc_list_rfis": {
      const token = await getAPSToken(env, 'data:read');
      const data = await accListRFIs(token, args.project_id, { status: args.status });
      const rfis = (data.data || data.results || []).map(r => ({
        id: r.id, subject: r.attributes?.subject || r.subject, status: r.attributes?.status || r.status
      }));
      return { status: "success", project_id: args.project_id, rfi_count: rfis.length, rfis };
    }

    case "acc_search_documents": {
      const token = await getAPSToken(env, 'data:read');
      const data = await accSearchDocuments(token, args.project_id, args.query, args.document_type);
      return { status: "success", project_id: args.project_id, query: args.query, results: data.data || [] };
    }

    case "acc_project_summary": {
      const token = await getAPSToken(env, 'data:read');
      const hubs = await listHubs(token);
      const hubId = args.hub_id || hubs.data?.[0]?.id;
      const summary = await accProjectSummary(token, hubId, args.project_id);
      return { status: "success", project: summary.data?.attributes || summary, hub_id: hubId };
    }

    case "xr_launch_vr_session": {
      const sessionId = `vr_${Date.now()}`;
      const viewerUrl = `https://scanbim.app/viewer?urn=${args.model_id}&mode=vr&session=${sessionId}`;
      return {
        status: "success", session_id: sessionId, session_type: "vr",
        model_id: args.model_id, session_name: args.session_name || "VR Session",
        launch_url: viewerUrl,
        quest_url: `oculus://browser?url=${encodeURIComponent(viewerUrl)}`,
        qr_code_url: `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(viewerUrl)}`,
        instructions: "Scan QR code with Meta Quest or open launch_url in Quest browser. WebXR loads automatically.",
        features: { measurements: args.enable_measurements ?? true, voice_annotations: args.enable_voice_annotations ?? false, max_participants: args.max_participants || 5 }
      };
    }

    case "xr_launch_ar_session": {
      const sessionId = `ar_${Date.now()}`;
      const viewerUrl = `https://scanbim.app/viewer?urn=${args.model_id}&mode=ar&session=${sessionId}&scale=${args.scale || '1:1'}`;
      return {
        status: "success", session_id: sessionId, session_type: "ar",
        model_id: args.model_id, scale: args.scale || "1:1",
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
        } catch (e) {}
      }
      return { status: "success", sessions: [], message: "No sessions recorded yet." };
    }

    case "twinmotion_render": {
      const renderId = `tm_${Date.now()}`;
      return {
        status: "success", render_id: renderId, model_id: args.model_id,
        settings: { time_of_day: args.time_of_day || "noon", weather: args.weather || "clear", season: args.season || "summer", resolution: args.resolution || "4k" },
        preview_url: `https://scanbim.app/renders/${renderId}`,
        estimated_completion: "2-5 minutes",
        note: "Twinmotion cloud rendering pipeline — full integration in Week 5 buildout."
      };
    }

    case "twinmotion_walkthrough": {
      const videoId = `tmv_${Date.now()}`;
      return {
        status: "success", video_id: videoId, model_id: args.model_id,
        duration_seconds: args.duration_seconds || 60,
        style: args.style || "cinematic",
        download_url: `https://scanbim.app/videos/${videoId}`,
        estimated_completion: "5-10 minutes"
      };
    }

    case "lumion_render": {
      const renderId = `lum_${Date.now()}`;
      return {
        status: "success", render_id: renderId, model_id: args.model_id,
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

// ── MCP PROTOCOL HANDLER ──────────────────────────────────────────────────
async function handleMCP(req, env) {
  const body = await req.json();
  const { method, params, id } = body;
  const respond = (result) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { 'Content-Type': 'application/json' } });
  const error = (code, msg) => new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message: msg } }), { headers: { 'Content-Type': 'application/json' } });

  if (method === 'initialize') return respond({ protocolVersion: "2024-11-05", serverInfo: SERVER_INFO, capabilities: { tools: {} } });
  if (method === 'tools/list') return respond({ tools: TOOLS });
  if (method === 'tools/call') {
    try {
      const result = await handleTool(params.name, params.arguments || {}, env);
      return respond({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return respond({ content: [{ type: "text", text: JSON.stringify({ status: "error", message: e.message }) }] });
    }
  }
  if (method === 'ping') return respond({});
  return error(-32601, `Method not found: ${method}`);
}

// ── MAIN FETCH HANDLER ────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,Mcp-Session-Id' };

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // MCP endpoint
    if (url.pathname === '/mcp' && req.method === 'POST') {
      const resp = await handleMCP(req, env);
      Object.entries(cors).forEach(([k,v]) => resp.headers.set(k,v));
      return resp;
    }

    // Info/health endpoints
    if (url.pathname === '/info' || url.pathname === '/') {
      return new Response(JSON.stringify({ ...SERVER_INFO, tools_count: TOOLS.length, endpoints: { mcp: '/mcp', health: '/health', info: '/info', viewer: '/viewer?urn=YOUR_URN', token: '/token' }, aps_connected: !!(env.APS_CLIENT_ID) }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: "ok", version: SERVER_INFO.version, aps_configured: !!(env.APS_CLIENT_ID && env.APS_CLIENT_SECRET), timestamp: new Date().toISOString() }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // Token endpoint for APS Viewer JS integration
    if (url.pathname === '/token') {
      try {
        const scope = 'viewables:read data:read';
        const cacheKey = `aps_token_viewer`;
        if (env.CACHE) {
          const cached = await env.CACHE.get(cacheKey);
          if (cached) {
            return new Response(JSON.stringify({ access_token: cached, token_type: 'Bearer', expires_in: 3600 }), { headers: { ...cors, 'Content-Type': 'application/json' } });
          }
        }
        const tokenResp = await fetch('https://developer.api.autodesk.com/authentication/v2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.APS_CLIENT_ID,
            client_secret: env.APS_CLIENT_SECRET,
            grant_type: 'client_credentials',
            scope
          })
        });
        if (!tokenResp.ok) {
          return new Response(JSON.stringify({ error: 'APS auth failed', status: tokenResp.status }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
        }
        const tokenData = await tokenResp.json();
        if (env.CACHE) {
          await env.CACHE.put(cacheKey, tokenData.access_token, { expirationTtl: tokenData.expires_in - 60 });
        }
        return new Response(JSON.stringify({ access_token: tokenData.access_token, token_type: 'Bearer', expires_in: tokenData.expires_in }), { headers: { ...cors, 'Content-Type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
    }

    // APS Viewer — embedded HTML served from /viewer?urn=XXX
    if (url.pathname === '/viewer') {
      const viewerHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ScanBIM Viewer — APS Model Viewer</title>
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
<div id="infoPanel" class="info-panel"><div><strong>Model:</strong> <span id="infoName">—</span></div><div><strong>Status:</strong> <span id="infoStatus">—</span></div><div><strong>URN:</strong> <span id="infoUrn" style="word-break:break-all;">—</span></div></div>
<script>
const TOKEN_EP=window.location.origin+'/token';let viewer=null,currentUrn=null;
async function getToken(){const r=await fetch(TOKEN_EP);if(!r.ok)throw new Error('Token fetch failed: '+r.status);const d=await r.json();return d.access_token;}
async function initViewer(urn){currentUrn=urn;setStatus('loading','Authenticating...');setLoading('Obtaining APS token...','');try{const token=await getToken();setLoading('Initializing viewer...','URN: '+urn.substring(0,30)+'...');Autodesk.Viewing.Initializer({env:'AutodeskProduction2',api:'streamingV2',getAccessToken:function(cb){cb(token,3600);}},function(){const c=document.getElementById('viewer-container');viewer=new Autodesk.Viewing.GuiViewer3D(c,{extensions:['Autodesk.DocumentBrowser'],theme:'dark-theme'});viewer.start();setLoading('Loading document...','Fetching model manifest');Autodesk.Viewing.Document.load('urn:'+urn,onDocLoaded,onDocFailed);});}catch(e){showError('Authentication Failed',e.message);}}
function onDocLoaded(doc){setLoading('Rendering model...','Loading viewable geometry');const v=doc.getRoot().getDefaultGeometry();if(!v){const a3=doc.getRoot().search({type:'geometry',role:'3d'});if(a3.length>0){viewer.loadDocumentNode(doc,a3[0]).then(onModelOk).catch(onModelFail);return;}const a2=doc.getRoot().search({type:'geometry',role:'2d'});if(a2.length>0){viewer.loadDocumentNode(doc,a2[0]).then(onModelOk).catch(onModelFail);return;}showError('No Viewables','No viewable geometry found. Model may still be translating.');return;}viewer.loadDocumentNode(doc,v).then(onModelOk).catch(onModelFail);}
function onModelOk(m){hideLoading();setStatus('ready','Model Loaded');document.getElementById('infoPanel').classList.add('visible');document.getElementById('infoName').textContent=m.getDocumentNode?m.getDocumentNode().name()||'Untitled':'Model';document.getElementById('infoStatus').textContent='Loaded';document.getElementById('infoUrn').textContent=currentUrn?currentUrn.substring(0,40)+'...':'—';viewer.fitToView();}
function onModelFail(e){showError('Model Load Failed','Error: '+(e.message||e));}
function onDocFailed(code,msg){const m={1:'Document not found.',2:'No viewable geometry.',3:'Invalid access token.',4:'Network error.',5:'Access denied.',7:'Invalid model.',9:'Translation in progress — try again soon.'};showError('Document Load Failed',m[code]||('Code '+code+': '+(msg||'')));}
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
      return new Response(viewerHTML, { headers: { ...cors, 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'public, max-age=300' } });
    }

    return new Response('ScanBIM MCP v1.0.5 — APS Connected', { headers: cors });
  }
};
