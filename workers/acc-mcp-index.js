// ACC MCP Worker v1.0.1 — APS-Backed ACC/BIM 360 Tools
// ScanBIM Labs LLC | Ian Martin

const APS_BASE = 'https://developer.api.autodesk.com';

const SERVER_INFO = {
  name: "acc-mcp",
  version: "1.0.1",
  description: "Autodesk Construction Cloud integration via APS. Manage projects, issues, RFIs, documents, and submittals.",
  author: "ScanBIM Labs LLC"
};

async function getAPSToken(env, scope = 'data:read data:write data:create') {
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
  if (!resp.ok) throw new Error(`APS auth failed`);
  const data = await resp.json();
  const token = data.access_token;
  if (env.CACHE) await env.CACHE.put(cacheKey, token, { expirationTtl: data.expires_in - 60 });
  return token;
}

async function listHubs(token) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`List hubs failed`);
  return await resp.json();
}

async function listProjects(token, hubId) {
  const resp = await fetch(`${APS_BASE}/project/v1/hubs/${hubId}/projects`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`List projects failed`);
  return await resp.json();
}

const TOOLS = [
  { name: "acc_list_projects", description: "List all ACC/BIM 360 projects you have access to via APS Data Management", inputSchema: { type: "object", properties: {} } },
  { name: "acc_create_issue", description: "Create a new issue in an ACC project via APS Issues API", inputSchema: { type: "object", properties: { project_id: { type: "string", description: "ACC project ID (b.xxxx format)" }, title: { type: "string" }, description: { type: "string" }, priority: { type: "string", enum: ["critical","high","medium","low"] }, assigned_to: { type: "string" }, due_date: { type: "string" } }, required: ["project_id", "title", "description"] } },
  { name: "acc_update_issue", description: "Update an existing ACC issue (status, priority, assignee, description)", inputSchema: { type: "object", properties: { project_id: { type: "string" }, issue_id: { type: "string" }, status: { type: "string", enum: ["open","in_review","closed","draft"] }, priority: { type: "string", enum: ["critical","high","medium","low"] }, assigned_to: { type: "string" }, description: { type: "string" } }, required: ["project_id", "issue_id"] } },
  { name: "acc_list_issues", description: "List and filter issues from an ACC project", inputSchema: { type: "object", properties: { project_id: { type: "string" }, status: { type: "string" }, priority: { type: "string" }, assigned_to: { type: "string" } }, required: ["project_id"] } },
  { name: "acc_create_rfi", description: "Create a new RFI in an ACC project via APS RFIs API", inputSchema: { type: "object", properties: { project_id: { type: "string" }, subject: { type: "string" }, question: { type: "string" }, assigned_to: { type: "string" }, priority: { type: "string", enum: ["critical","high","medium","low"] } }, required: ["project_id", "subject", "question"] } },
  { name: "acc_list_rfis", description: "List and filter RFIs from an ACC project", inputSchema: { type: "object", properties: { project_id: { type: "string" }, status: { type: "string" } }, required: ["project_id"] } },
  { name: "acc_search_documents", description: "Search drawings, specs, submittals and documents in ACC via APS Data Management", inputSchema: { type: "object", properties: { project_id: { type: "string" }, query: { type: "string" }, document_type: { type: "string" } }, required: ["project_id", "query"] } },
  { name: "acc_upload_file", description: "Upload a file to an ACC project folder via APS Data Management", inputSchema: { type: "object", properties: { project_id: { type: "string" }, file_url: { type: "string" }, file_name: { type: "string" }, folder_path: { type: "string" } }, required: ["project_id", "file_url", "file_name"] } },
  { name: "acc_project_summary", description: "Get full ACC project summary including hub, metadata, issue counts, and RFI counts", inputSchema: { type: "object", properties: { project_id: { type: "string" }, hub_id: { type: "string" } }, required: ["project_id"] } }
];

async function handleTool(name, args, env) {
  if (env.DB) {
    try { await env.DB.prepare("INSERT INTO usage_log (tool_name, model_id, created_at) VALUES (?, ?, ?)").bind(name, args.project_id || null, new Date().toISOString()).run(); } catch (e) {}
  }

  switch (name) {
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
      const cleanId = args.project_id.replace(/^b\./, '');
      const resp = await fetch(`${APS_BASE}/construction/issues/v1/projects/${cleanId}/issues`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: args.title,
          description: args.description,
          status: 'open',
          priority: args.priority || 'medium',
          assignedTo: args.assigned_to || null,
          dueDate: args.due_date || null
        })
      });
      if (!resp.ok) throw new Error(`Create issue failed: ${await resp.text()}`);
      const issue = await resp.json();
      return { status: "success", issue_id: issue.data?.id || issue.id, title: args.title, priority: args.priority || 'medium', project_id: args.project_id };
    }

    case "acc_update_issue": {
      const token = await getAPSToken(env, 'data:read data:write');
      const cleanId = args.project_id.replace(/^b\./, '');
      const updateBody = {};
      if (args.status) updateBody.status = args.status;
      if (args.priority) updateBody.priority = args.priority;
      if (args.assigned_to) updateBody.assignedTo = args.assigned_to;
      if (args.description) updateBody.description = args.description;
      const resp = await fetch(`${APS_BASE}/construction/issues/v1/projects/${cleanId}/issues/${args.issue_id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody)
      });
      if (!resp.ok) throw new Error(`Update issue failed: ${await resp.text()}`);
      const issue = await resp.json();
      return { status: "success", issue_id: args.issue_id, updated_fields: Object.keys(updateBody) };
    }

    case "acc_list_issues": {
      const token = await getAPSToken(env, 'data:read');
      const cleanId = args.project_id.replace(/^b\./, '');
      let url = `${APS_BASE}/construction/issues/v1/projects/${cleanId}/issues?limit=50`;
      if (args.status) url += `&filter[status]=${args.status}`;
      if (args.priority) url += `&filter[priority]=${args.priority}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`List issues failed: ${await resp.text()}`);
      const data = await resp.json();
      const issues = (data.data || data.results || []).map(function(i) {
        return {
          id: i.id,
          title: i.attributes ? i.attributes.title : i.title,
          status: i.attributes ? i.attributes.status : i.status,
          priority: i.attributes ? i.attributes.priority : i.priority,
          due_date: i.attributes ? i.attributes.dueDate : i.due_date
        };
      });
      return { status: "success", project_id: args.project_id, issue_count: issues.length, issues: issues };
    }

    case "acc_create_rfi": {
      const token = await getAPSToken(env, 'data:read data:write');
      const cleanId = args.project_id.replace(/^b\./, '');
      const resp = await fetch(`${APS_BASE}/construction/rfis/v1/projects/${cleanId}/rfis`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: args.subject,
          question: args.question,
          assignedTo: args.assigned_to || null,
          priority: args.priority || 'medium',
          status: 'draft'
        })
      });
      if (!resp.ok) throw new Error(`Create RFI failed: ${await resp.text()}`);
      const rfi = await resp.json();
      return { status: "success", rfi_id: rfi.data?.id || rfi.id, subject: args.subject, project_id: args.project_id };
    }

    case "acc_list_rfis": {
      const token = await getAPSToken(env, 'data:read');
      const cleanId = args.project_id.replace(/^b\./, '');
      let url = `${APS_BASE}/construction/rfis/v1/projects/${cleanId}/rfis?limit=50`;
      if (args.status) url += `&filter[status]=${args.status}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`List RFIs failed: ${await resp.text()}`);
      const data = await resp.json();
      const rfis = (data.data || data.results || []).map(function(r) {
        return {
          id: r.id,
          subject: r.attributes ? r.attributes.subject : r.subject,
          status: r.attributes ? r.attributes.status : r.status
        };
      });
      return { status: "success", project_id: args.project_id, rfi_count: rfis.length, rfis: rfis };
    }

    case "acc_search_documents": {
      const token = await getAPSToken(env, 'data:read');
      const cleanId = args.project_id.replace(/^b\./, '');
      let url = `${APS_BASE}/data/v1/projects/b.${cleanId}/search?filter[text]=${encodeURIComponent(args.query)}`;
      if (args.document_type) url += `&filter[type]=${args.document_type}`;
      const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!resp.ok) throw new Error(`Document search failed: ${await resp.text()}`);
      const data = await resp.json();
      return { status: "success", project_id: args.project_id, query: args.query, results: data.data || [] };
    }

    case "acc_upload_file": {
      const token = await getAPSToken(env, 'data:read data:write data:create');
      const cleanId = args.project_id.replace(/^b\./, '');
      const projectId = `b.${cleanId}`;
      const folderPath = args.folder_path || "Project Files";

      // Step 1: Get top-level folder for the project
      const foldersResp = await fetch(
        `${APS_BASE}/project/v1/hubs/b.${cleanId.split('.')[0] || cleanId}/projects/${projectId}/topFolders`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // Fallback: try listing hubs first to get the correct hub ID
      let folderId = null;
      if (foldersResp.ok) {
        const foldersData = await foldersResp.json();
        const targetFolder = (foldersData.data || []).find(function(f) {
          const name = f.attributes?.displayName || f.attributes?.name || '';
          return name.toLowerCase().includes(folderPath.toLowerCase());
        });
        if (targetFolder) folderId = targetFolder.id;

        // If no match, use the first folder (usually "Project Files")
        if (!folderId && foldersData.data && foldersData.data.length > 0) {
          folderId = foldersData.data[0].id;
        }
      }

      if (!folderId) {
        // Try alternate hub discovery
        const hubs = await listHubs(token);
        for (const hub of (hubs.data || [])) {
          const tfResp = await fetch(
            `${APS_BASE}/project/v1/hubs/${hub.id}/projects/${projectId}/topFolders`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (tfResp.ok) {
            const tfData = await tfResp.json();
            const match = (tfData.data || []).find(function(f) {
              const name = f.attributes?.displayName || f.attributes?.name || '';
              return name.toLowerCase().includes(folderPath.toLowerCase());
            });
            folderId = match ? match.id : (tfData.data?.[0]?.id || null);
            if (folderId) break;
          }
        }
      }

      if (!folderId) {
        return { status: "error", message: "Could not find target folder in project. Verify project_id and folder_path." };
      }

      // Step 2: Create storage location
      const storageResp = await fetch(`${APS_BASE}/data/v1/projects/${projectId}/storage`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          jsonapi: { version: "1.0" },
          data: {
            type: "objects",
            attributes: { name: args.file_name },
            relationships: {
              target: {
                data: { type: "folders", id: folderId }
              }
            }
          }
        })
      });

      if (!storageResp.ok) {
        const errText = await storageResp.text();
        throw new Error(`Storage creation failed (${storageResp.status}): ${errText}`);
      }

      const storageData = await storageResp.json();
      const objectId = storageData.data?.id;

      if (!objectId) {
        throw new Error("No storage object ID returned");
      }

      // Extract the signed upload URL from the storage object ID
      // Format: urn:adsk.objects:os.object:wip.dm.prod/GUID
      const bucketKey = objectId.split(':').pop().split('/')[0];
      const objectKey = objectId.split('/').slice(1).join('/');
      const uploadUrl = `${APS_BASE}/oss/v2/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}`;

      // Step 3: Fetch file from source URL and upload to APS storage
      const fileResp = await fetch(args.file_url);
      if (!fileResp.ok) {
        throw new Error(`Cannot fetch source file from ${args.file_url}`);
      }
      const fileBytes = await fileResp.arrayBuffer();
      const fileSizeMB = (fileBytes.byteLength / 1048576).toFixed(2);

      const ossResp = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/octet-stream',
          'Content-Length': fileBytes.byteLength.toString()
        },
        body: fileBytes
      });

      if (!ossResp.ok) {
        const errText = await ossResp.text();
        throw new Error(`File upload failed (${ossResp.status}): ${errText}`);
      }

      // Step 4: Create first version (item) in the folder
      const itemResp = await fetch(`${APS_BASE}/data/v1/projects/${projectId}/items`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({
          jsonapi: { version: "1.0" },
          data: {
            type: "items",
            attributes: {
              displayName: args.file_name,
              extension: {
                type: "items:autodesk.bim360:File",
                version: "1.0"
              }
            },
            relationships: {
              tip: {
                data: { type: "versions", id: "1" }
              },
              parent: {
                data: { type: "folders", id: folderId }
              }
            }
          },
          included: [{
            type: "versions",
            id: "1",
            attributes: {
              name: args.file_name,
              extension: {
                type: "versions:autodesk.bim360:File",
                version: "1.0"
              }
            },
            relationships: {
              storage: {
                data: { type: "objects", id: objectId }
              }
            }
          }]
        })
      });

      if (!itemResp.ok) {
        const errText = await itemResp.text();
        throw new Error(`Item creation failed (${itemResp.status}): ${errText}`);
      }

      const itemData = await itemResp.json();
      const itemId = itemData.data?.id;
      const versionId = itemData.included?.[0]?.id;

      return {
        status: "success",
        project_id: args.project_id,
        folder_id: folderId,
        folder_path: folderPath,
        file_name: args.file_name,
        file_size_mb: fileSizeMB,
        item_id: itemId,
        version_id: versionId,
        storage_object_id: objectId,
        upload_status: "complete",
        timestamp: new Date().toISOString()
      };
    }

    case "acc_project_summary": {
      const token = await getAPSToken(env, 'data:read');
      const hubs = await listHubs(token);
      const hubId = args.hub_id || (hubs.data && hubs.data[0] ? hubs.data[0].id : null);
      if (!hubId) return { status: "error", message: "No hubs found" };
      const resp = await fetch(`${APS_BASE}/project/v1/hubs/${hubId}/projects/${args.project_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) throw new Error(`Project summary failed: ${await resp.text()}`);
      const summary = await resp.json();
      return { status: "success", project: summary.data?.attributes || summary, hub_id: hubId };
    }

    default:
      return { status: "error", message: "Unknown tool: " + name };
  }
}

async function handleMCP(req, env) {
  const body = await req.json();
  var method = body.method;
  var params = body.params;
  var id = body.id;
  var respond = function(result) { return new Response(JSON.stringify({ jsonrpc: "2.0", id: id, result: result }), { headers: { 'Content-Type': 'application/json' } }); };
  var error = function(code, msg) { return new Response(JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: code, message: msg } }), { headers: { 'Content-Type': 'application/json' } }); };

  if (method === 'initialize') return respond({ protocolVersion: "2024-11-05", serverInfo: SERVER_INFO, capabilities: { tools: {} } });
  if (method === 'tools/list') return respond({ tools: TOOLS });
  if (method === 'tools/call') {
    try {
      var result = await handleTool(params.name, params.arguments || {}, env);
      return respond({ content: [{ type: "text", text: JSON.stringify(result, null, 2) }] });
    } catch (e) {
      return respond({ content: [{ type: "text", text: JSON.stringify({ status: "error", message: e.message }) }] });
    }
  }
  if (method === 'ping') return respond({});
  return error(-32601, "Method not found");
}

export default {
  async fetch(req, env) {
    var url = new URL(req.url);
    var cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' };

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    if (url.pathname === '/mcp' && req.method === 'POST') {
      var resp = await handleMCP(req, env);
      Object.entries(cors).forEach(function(e) { resp.headers.set(e[0], e[1]); });
      return resp;
    }

    if (url.pathname === '/info' || url.pathname === '/') {
      return new Response(JSON.stringify({ name: SERVER_INFO.name, version: SERVER_INFO.version, description: SERVER_INFO.description, tools_count: TOOLS.length }, null, 2), { headers: Object.assign({}, cors, { 'Content-Type': 'application/json' }) });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: "ok", version: SERVER_INFO.version, aps_configured: !!(env.APS_CLIENT_ID && env.APS_CLIENT_SECRET) }), { headers: Object.assign({}, cors, { 'Content-Type': 'application/json' }) });
    }

    return new Response('ACC MCP v1.0.1 by ScanBIM Labs', { headers: cors });
  }
};
