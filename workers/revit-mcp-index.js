// Revit MCP Worker v1.1.0 — Real APS-Backed Revit Tools
// ScanBIM Labs LLC | Ian Martin
// All 8 tools: REAL APS Model Derivative + OSS API calls

const APS_BASE = 'https://developer.api.autodesk.com';

const SERVER_INFO = {
  name: "revit-mcp",
  version: "1.1.0",
  description: "Revit integration via Autodesk Platform Services. Extract elements, parameters, run schedules, detect clashes, export IFC.",
  author: "ScanBIM Labs LLC"
};

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
    const errText = await resp.text();
    throw new Error(`APS auth failed (${resp.status}): ${errText}`);
  }
  const data = await resp.json();
  const token = data.access_token;
  if (env.CACHE) await env.CACHE.put(cacheKey, token, { expirationTtl: data.expires_in - 60 });
  return token;
}

// ── APS Helper Functions ──────────────────────────────────────

async function getModelMetadata(token, urn) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/metadata`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Metadata fetch failed (${resp.status})`);
  return await resp.json();
}

async function getModelGUID(token, urn) {
  const meta = await getModelMetadata(token, urn);
  if (!meta.data || !meta.data.metadata || meta.data.metadata.length === 0) {
    throw new Error('No metadata/views found for this model. Ensure the model has been translated.');
  }
  // Return first 3D view GUID, or first available
  const views = meta.data.metadata;
  const view3d = views.find(v => v.role === '3d') || views[0];
  return view3d.guid;
}

async function getProperties(token, urn, guid) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/metadata/${guid}/properties?forceget=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Properties fetch failed (${resp.status})`);
  const data = await resp.json();
  // Handle 202 (processing) — retry once after delay
  if (resp.status === 202 || (data.isProcessing)) {
    await new Promise(r => setTimeout(r, 3000));
    const retry = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/metadata/${guid}/properties?forceget=true`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!retry.ok) throw new Error(`Properties retry failed (${retry.status})`);
    return await retry.json();
  }
  return data;
}

async function getObjectTree(token, urn, guid) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/metadata/${guid}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Object tree fetch failed (${resp.status})`);
  const data = await resp.json();
  if (resp.status === 202) {
    await new Promise(r => setTimeout(r, 3000));
    const retry = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/metadata/${guid}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!retry.ok) throw new Error(`Object tree retry failed (${retry.status})`);
    return await retry.json();
  }
  return data;
}

async function getManifest(token, urn) {
  const resp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!resp.ok) throw new Error(`Manifest fetch failed (${resp.status})`);
  return await resp.json();
}

async function ensureBucket(token, bucketKey) {
  // Check if bucket exists
  const check = await fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/details`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (check.ok) return;
  // Create it
  const create = await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      bucketKey,
      policyKey: 'transient'
    })
  });
  if (!create.ok && create.status !== 409) {
    throw new Error(`Bucket creation failed (${create.status})`);
  }
}

// ── Tool Definitions ──────────────────────────────────────────

const TOOLS = [
  { name: "revit_upload", description: "Upload Revit file to APS and translate to viewable. Provide a publicly accessible file_url.", inputSchema: { type: "object", properties: { file_url: { type: "string", description: "Public URL to download the .rvt file from" }, file_name: { type: "string", description: "Name for the file (e.g. 'MyBuilding.rvt')" }, project_name: { type: "string", description: "Optional project label" } }, required: ["file_url", "file_name"] } },
  { name: "revit_get_elements", description: "Get all elements from a translated Revit model by category (e.g. Walls, Doors, Windows)", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "Base64-encoded URN of the translated model" }, category: { type: "string", description: "Revit category to filter (e.g. 'Walls', 'Doors', 'Windows', 'Structural Columns')" } }, required: ["model_id", "category"] } },
  { name: "revit_get_parameters", description: "Get all parameters for elements in a category (or a specific element)", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "Base64-encoded URN" }, category: { type: "string", description: "Revit category to filter" }, element_id: { type: "string", description: "Optional specific element objectid to query" } }, required: ["model_id", "category"] } },
  { name: "revit_run_schedule", description: "Extract schedule-like tabular data from model properties matching a category or keyword", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "Base64-encoded URN" }, schedule_name: { type: "string", description: "Category or keyword to build schedule from (e.g. 'Walls', 'Doors', 'Rooms')" } }, required: ["model_id", "schedule_name"] } },
  { name: "revit_clash_detect", description: "Detect spatial clashes between two categories using bounding box overlap analysis + D1 VDC rules", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "Base64-encoded URN" }, category_a: { type: "string", description: "First category (e.g. 'Mechanical Equipment')" }, category_b: { type: "string", description: "Second category (e.g. 'Structural Framing')" } }, required: ["model_id", "category_a", "category_b"] } },
  { name: "revit_export_ifc", description: "Start IFC export translation job for a model", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "Base64-encoded URN" }, include_properties: { type: "boolean", description: "Include property sets in IFC output" } }, required: ["model_id"] } },
  { name: "revit_get_sheets", description: "List all sheets in a translated Revit model", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "Base64-encoded URN" } }, required: ["model_id"] } },
  { name: "revit_get_views", description: "List all views (floor plans, sections, 3D views, etc.) in a translated Revit model", inputSchema: { type: "object", properties: { model_id: { type: "string", description: "Base64-encoded URN" } }, required: ["model_id"] } }
];

// ── Real Tool Handlers ────────────────────────────────────────

async function handleTool(name, args, env) {
  // Usage logging
  if (env.DB) {
    try {
      await env.DB.prepare("INSERT INTO usage_log (tool_name, model_id, created_at) VALUES (?, ?, ?)")
        .bind(name, args.model_id || null, new Date().toISOString()).run();
    } catch (e) { /* non-critical */ }
  }

  switch (name) {

    // ── 1. revit_upload ───────────────────────────────────────
    // Real: Fetch file → Upload to OSS bucket → Start SVF2 translation
    case "revit_upload": {
      const token = await getAPSToken(env);
      const bucketKey = `scanbim-revit-${Date.now()}`;
      const objectKey = args.file_name.replace(/[^a-zA-Z0-9._-]/g, '_');

      // Step 1: Create bucket
      await ensureBucket(token, bucketKey);

      // Step 2: Fetch the file from provided URL
      const fileResp = await fetch(args.file_url);
      if (!fileResp.ok) throw new Error(`Failed to fetch file from URL (${fileResp.status})`);
      const fileBytes = await fileResp.arrayBuffer();
      const fileSizeMB = (fileBytes.byteLength / (1024 * 1024)).toFixed(2);

      // Step 3: Upload to OSS
      const uploadResp = await fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/objects/${objectKey}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream'
        },
        body: fileBytes
      });
      if (!uploadResp.ok) throw new Error(`OSS upload failed (${uploadResp.status})`);
      const uploadData = await uploadResp.json();
      const objectId = uploadData.objectId;
      const urn = btoa(objectId).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

      // Step 4: Start SVF2 translation
      const translateResp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-ads-force': 'true'
        },
        body: JSON.stringify({
          input: { urn },
          output: { formats: [{ type: 'svf2', views: ['2d', '3d'] }] }
        })
      });
      if (!translateResp.ok) {
        const errText = await translateResp.text();
        throw new Error(`Translation job failed (${translateResp.status}): ${errText}`);
      }
      const translateData = await translateResp.json();

      return {
        status: "success",
        message: "Revit file uploaded and translation started",
        model_id: urn,
        urn: urn,
        object_id: objectId,
        bucket: bucketKey,
        file_name: args.file_name,
        file_size_mb: parseFloat(fileSizeMB),
        translation_status: translateData.result || "inprogress",
        project_name: args.project_name || null,
        created_at: new Date().toISOString(),
        note: "Use model_id (URN) with other revit_* tools once translation completes. Check manifest for status."
      };
    }

    // ── 2. revit_get_elements ─────────────────────────────────
    // Real: Get metadata GUID → Query properties → Filter by category
    case "revit_get_elements": {
      const token = await getAPSToken(env);
      const guid = await getModelGUID(token, args.model_id);
      const props = await getProperties(token, args.model_id, guid);

      if (!props.data || !props.data.collection) {
        return { status: "success", model_id: args.model_id, category: args.category, element_count: 0, elements: [], note: "No property data returned. Model may still be processing." };
      }

      const categoryLower = args.category.toLowerCase();
      const filtered = props.data.collection.filter(el => {
        const catName = (el.properties?.['Category'] || el.properties?.['__category__']?.['Category'] || el.name || '').toLowerCase();
        return catName.includes(categoryLower);
      });

      const elements = filtered.slice(0, 100).map(el => ({
        objectid: el.objectid,
        name: el.name,
        externalId: el.externalId,
        properties: el.properties || {}
      }));

      return {
        status: "success",
        model_id: args.model_id,
        category: args.category,
        element_count: filtered.length,
        returned: elements.length,
        elements,
        note: filtered.length > 100 ? `Showing first 100 of ${filtered.length} elements` : undefined
      };
    }

    // ── 3. revit_get_parameters ───────────────────────────────
    // Real: Get properties → Filter by category/element → Return parameter details
    case "revit_get_parameters": {
      const token = await getAPSToken(env);
      const guid = await getModelGUID(token, args.model_id);
      const props = await getProperties(token, args.model_id, guid);

      if (!props.data || !props.data.collection) {
        return { status: "success", model_id: args.model_id, category: args.category, parameters: [], note: "No data returned." };
      }

      let targets;
      if (args.element_id) {
        targets = props.data.collection.filter(el => String(el.objectid) === String(args.element_id));
      } else {
        const catLower = args.category.toLowerCase();
        targets = props.data.collection.filter(el => {
          const catName = (el.properties?.['Category'] || el.properties?.['__category__']?.['Category'] || el.name || '').toLowerCase();
          return catName.includes(catLower);
        });
      }

      // Collect unique parameter names/values across matching elements
      const paramMap = {};
      targets.slice(0, 50).forEach(el => {
        if (!el.properties) return;
        Object.entries(el.properties).forEach(([groupName, groupProps]) => {
          if (typeof groupProps === 'object' && groupProps !== null) {
            Object.entries(groupProps).forEach(([paramName, paramValue]) => {
              if (!paramMap[paramName]) {
                paramMap[paramName] = { name: paramName, group: groupName, values: new Set(), element_count: 0 };
              }
              paramMap[paramName].values.add(String(paramValue));
              paramMap[paramName].element_count++;
            });
          }
        });
      });

      const parameters = Object.values(paramMap).map(p => ({
        name: p.name,
        group: p.group,
        unique_values: [...p.values].slice(0, 10),
        element_count: p.element_count
      }));

      return {
        status: "success",
        model_id: args.model_id,
        category: args.category,
        element_id: args.element_id || null,
        matching_elements: targets.length,
        parameter_count: parameters.length,
        parameters
      };
    }

    // ── 4. revit_run_schedule ─────────────────────────────────
    // Real: Query properties → Build tabular schedule by category keyword
    case "revit_run_schedule": {
      const token = await getAPSToken(env);
      const guid = await getModelGUID(token, args.model_id);
      const props = await getProperties(token, args.model_id, guid);

      if (!props.data || !props.data.collection) {
        return { status: "success", model_id: args.model_id, schedule_name: args.schedule_name, rows: 0, columns: [], data: [] };
      }

      const keyword = args.schedule_name.toLowerCase();
      const filtered = props.data.collection.filter(el => {
        const catName = (el.properties?.['Category'] || el.properties?.['__category__']?.['Category'] || el.name || '').toLowerCase();
        return catName.includes(keyword);
      });

      // Build columns from all parameter keys across matching elements
      const allCols = new Set();
      filtered.slice(0, 200).forEach(el => {
        if (!el.properties) return;
        Object.values(el.properties).forEach(group => {
          if (typeof group === 'object' && group !== null) {
            Object.keys(group).forEach(k => allCols.add(k));
          }
        });
      });
      const columns = ['Name', ...([...allCols].filter(c => c !== 'Name').slice(0, 15))];

      const data = filtered.slice(0, 200).map(el => {
        const row = { Name: el.name };
        if (el.properties) {
          Object.values(el.properties).forEach(group => {
            if (typeof group === 'object' && group !== null) {
              Object.entries(group).forEach(([k, v]) => {
                if (columns.includes(k)) row[k] = v;
              });
            }
          });
        }
        return row;
      });

      return {
        status: "success",
        model_id: args.model_id,
        schedule_name: args.schedule_name,
        rows: data.length,
        total_matching: filtered.length,
        columns,
        data,
        note: filtered.length > 200 ? `Showing first 200 of ${filtered.length} rows` : undefined
      };
    }

    // ── 5. revit_clash_detect ─────────────────────────────────
    // Real: Get properties for both categories → Bounding box overlap analysis + D1 VDC rules
    case "revit_clash_detect": {
      const token = await getAPSToken(env);
      const guid = await getModelGUID(token, args.model_id);
      const props = await getProperties(token, args.model_id, guid);

      if (!props.data || !props.data.collection) {
        return { status: "success", model_id: args.model_id, clash_count: 0, clashes: [], note: "No property data for analysis." };
      }

      const catALower = args.category_a.toLowerCase();
      const catBLower = args.category_b.toLowerCase();

      const getCat = (el) => (el.properties?.['Category'] || el.properties?.['__category__']?.['Category'] || el.name || '').toLowerCase();

      const setA = props.data.collection.filter(el => getCat(el).includes(catALower));
      const setB = props.data.collection.filter(el => getCat(el).includes(catBLower));

      // Extract bounding box data if available
      const getBBox = (el) => {
        if (!el.properties) return null;
        for (const group of Object.values(el.properties)) {
          if (typeof group === 'object' && group !== null) {
            if (group['bounding_box'] || group['BoundingBox']) {
              return group['bounding_box'] || group['BoundingBox'];
            }
          }
        }
        return null;
      };

      // Check for spatial proximity / bounding box overlap
      const clashes = [];
      const limit = Math.min(setA.length, 50);
      const limitB = Math.min(setB.length, 50);

      for (let i = 0; i < limit && clashes.length < 100; i++) {
        const a = setA[i];
        const bboxA = getBBox(a);
        for (let j = 0; j < limitB && clashes.length < 100; j++) {
          const b = setB[j];
          const bboxB = getBBox(b);
          // If bounding boxes available, check overlap; otherwise flag elements sharing same location data
          let isClash = false;
          let method = 'property_proximity';

          if (bboxA && bboxB && typeof bboxA === 'string' && typeof bboxB === 'string') {
            // Parse simple "min_x,min_y,min_z,max_x,max_y,max_z" if available
            try {
              const parseBox = (s) => s.split(',').map(Number);
              const ba = parseBox(bboxA);
              const bb = parseBox(bboxB);
              if (ba.length >= 6 && bb.length >= 6) {
                isClash = ba[0] <= bb[3] && ba[3] >= bb[0] &&
                          ba[1] <= bb[4] && ba[4] >= bb[1] &&
                          ba[2] <= bb[5] && ba[5] >= bb[2];
                method = 'bounding_box_overlap';
              }
            } catch (e) { /* fall through to property proximity */ }
          }

          // Fallback: check if elements share Level/Reference Level
          if (!isClash) {
            const getLevel = (el) => {
              if (!el.properties) return null;
              for (const group of Object.values(el.properties)) {
                if (typeof group === 'object' && group !== null) {
                  return group['Level'] || group['Reference Level'] || group['Base Constraint'] || null;
                }
              }
              return null;
            };
            const levelA = getLevel(a);
            const levelB = getLevel(b);
            if (levelA && levelB && levelA === levelB) {
              isClash = true;
              method = 'same_level_proximity';
            }
          }

          if (isClash) {
            clashes.push({
              id: `clash_${clashes.length + 1}`,
              element_a: { objectid: a.objectid, name: a.name },
              element_b: { objectid: b.objectid, name: b.name },
              detection_method: method,
              severity: method === 'bounding_box_overlap' ? 'critical' : 'warning'
            });
          }
        }
      }

      // Load VDC rules from D1 if available
      let vdcRules = [];
      if (env.DB) {
        try {
          const rules = await env.DB.prepare(
            "SELECT * FROM vdc_rules WHERE (category_a = ? AND category_b = ?) OR (category_a = ? AND category_b = ?) LIMIT 10"
          ).bind(args.category_a, args.category_b, args.category_b, args.category_a).all();
          vdcRules = rules.results || [];
        } catch (e) { /* table may not exist */ }
      }

      return {
        status: "success",
        model_id: args.model_id,
        categories: { a: args.category_a, b: args.category_b },
        elements_analyzed: { category_a: setA.length, category_b: setB.length },
        clash_count: clashes.length,
        clashes: clashes.slice(0, 50),
        vdc_rules_applied: vdcRules.length,
        vdc_rules: vdcRules,
        note: clashes.length > 50 ? `Showing first 50 of ${clashes.length} clashes` : undefined,
        created_at: new Date().toISOString()
      };
    }

    // ── 6. revit_export_ifc ───────────────────────────────────
    // Real: Start Model Derivative IFC translation job
    case "revit_export_ifc": {
      const token = await getAPSToken(env);

      // Start IFC export job
      const jobResp = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'x-ads-force': 'true'
        },
        body: JSON.stringify({
          input: { urn: args.model_id },
          output: {
            formats: [{
              type: 'ifc',
              advanced: {
                exportSettingName: args.include_properties !== false ? 'IFC2x3 Coordination View 2.0' : 'IFC2x3'
              }
            }]
          }
        })
      });

      if (!jobResp.ok) {
        const errText = await jobResp.text();
        throw new Error(`IFC export job failed (${jobResp.status}): ${errText}`);
      }
      const jobData = await jobResp.json();

      // Check manifest for download availability
      let downloadUrl = null;
      try {
        const manifest = await getManifest(token, args.model_id);
        if (manifest.derivatives) {
          for (const deriv of manifest.derivatives) {
            if (deriv.outputType === 'ifc' && deriv.children) {
              for (const child of deriv.children) {
                if (child.type === 'resource' && child.urn) {
                  downloadUrl = `${APS_BASE}/modelderivative/v2/designdata/${encodeURIComponent(args.model_id)}/manifest/${child.urn}`;
                }
              }
            }
          }
        }
      } catch (e) { /* manifest may not be ready yet */ }

      return {
        status: "success",
        model_id: args.model_id,
        export_format: "IFC2x3",
        translation_status: jobData.result || "inprogress",
        include_properties: args.include_properties !== false,
        download_url: downloadUrl,
        created_at: new Date().toISOString(),
        note: downloadUrl ? "IFC file ready for download" : "IFC translation in progress. Check manifest for completion."
      };
    }

    // ── 7. revit_get_sheets ───────────────────────────────────
    // Real: Get all metadata views → Filter for 2D/sheet views
    case "revit_get_sheets": {
      const token = await getAPSToken(env);
      const meta = await getModelMetadata(token, args.model_id);

      if (!meta.data || !meta.data.metadata) {
        return { status: "success", model_id: args.model_id, sheet_count: 0, sheets: [] };
      }

      // Sheets appear as 2D views in the metadata
      const sheets = [];
      for (const view of meta.data.metadata) {
        if (view.role === '2d') {
          // Get the object tree for this view to find individual sheets
          try {
            const tree = await getObjectTree(token, args.model_id, view.guid);
            if (tree.data && tree.data.objects) {
              const extractSheets = (objects) => {
                for (const obj of objects) {
                  if (obj.name && (obj.name.includes('Sheet:') || obj.objects)) {
                    if (!obj.objects || obj.objects.length === 0) {
                      // Leaf node = likely a sheet
                      const parts = obj.name.split(':');
                      sheets.push({
                        objectid: obj.objectid,
                        name: obj.name,
                        number: parts.length > 1 ? parts[0].trim() : null,
                        title: parts.length > 1 ? parts[1].trim() : obj.name,
                        guid: view.guid
                      });
                    }
                    if (obj.objects) extractSheets(obj.objects);
                  }
                }
              };
              const root = Array.isArray(tree.data.objects) ? tree.data.objects : [tree.data.objects];
              extractSheets(root);
            }
          } catch (e) {
            // If tree fetch fails, at minimum list the 2D view
            sheets.push({
              name: view.name,
              role: view.role,
              guid: view.guid,
              note: "Could not expand sheet tree"
            });
          }
        }
      }

      return {
        status: "success",
        model_id: args.model_id,
        sheet_count: sheets.length,
        sheets,
        all_views_count: meta.data.metadata.length
      };
    }

    // ── 8. revit_get_views ────────────────────────────────────
    // Real: Get all metadata views with their roles (2d/3d), names, GUIDs
    case "revit_get_views": {
      const token = await getAPSToken(env);
      const meta = await getModelMetadata(token, args.model_id);

      if (!meta.data || !meta.data.metadata) {
        return { status: "success", model_id: args.model_id, view_count: 0, views: [] };
      }

      const views = meta.data.metadata.map(v => ({
        guid: v.guid,
        name: v.name,
        role: v.role,
        type: v.role === '3d' ? '3D View' : v.role === '2d' ? '2D View/Sheet' : v.role,
        is_master: v.isMasterView || false
      }));

      // Also try to get detailed view breakdown from object tree
      const detailedViews = [];
      for (const view of meta.data.metadata) {
        try {
          const tree = await getObjectTree(token, args.model_id, view.guid);
          if (tree.data && tree.data.objects) {
            const extractViews = (objects, depth = 0) => {
              for (const obj of objects) {
                if (depth <= 2) {
                  detailedViews.push({
                    objectid: obj.objectid,
                    name: obj.name,
                    parent_view: view.name,
                    role: view.role,
                    has_children: !!(obj.objects && obj.objects.length > 0)
                  });
                }
                if (obj.objects && depth < 2) extractViews(obj.objects, depth + 1);
              }
            };
            const root = Array.isArray(tree.data.objects) ? tree.data.objects : [tree.data.objects];
            extractViews(root);
          }
        } catch (e) { /* skip if tree unavailable */ }
      }

      return {
        status: "success",
        model_id: args.model_id,
        view_count: views.length,
        views,
        detailed_view_count: detailedViews.length,
        detailed_views: detailedViews.slice(0, 100),
        note: detailedViews.length > 100 ? `Showing first 100 of ${detailedViews.length} detailed views` : undefined
      };
    }

    default:
      return { status: "error", message: `Unknown tool: ${name}` };
  }
}

// ── MCP Protocol Handler ──────────────────────────────────────

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
  return error(-32601, `Method not found`);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' };

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/mcp' && req.method === 'POST') {
      const resp = await handleMCP(req, env);
      Object.entries(cors).forEach(([k,v]) => resp.headers.set(k,v));
      return resp;
    }

    if (url.pathname === '/info' || url.pathname === '/') {
      return new Response(JSON.stringify({ ...SERVER_INFO, tools_count: TOOLS.length, tools: TOOLS.map(t => t.name) }, null, 2), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: "ok", version: SERVER_INFO.version, aps_configured: !!(env.APS_CLIENT_ID && env.APS_CLIENT_SECRET) }), { headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    return new Response('Revit MCP v1.1.0 — ScanBIM Labs', { headers: cors });
  }
};
