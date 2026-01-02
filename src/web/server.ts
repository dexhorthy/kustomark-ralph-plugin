import { readFile } from "fs/promises";
import { dirname, resolve, join } from "path";
import { existsSync } from "fs";
import { loadConfigFile } from "../core/config.js";
import { resolveResources } from "../core/resources.js";
import { applyPatches, resolveExtends } from "../core/patches.js";
import { lintConfig } from "../core/lint.js";
import * as Diff from "diff";

/**
 * Web UI server configuration
 */
export interface WebServerConfig {
  port: number;
  configPath: string;
}

/**
 * API response types
 */
interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ConfigInfo {
  path: string;
  content: string;
  parsed: {
    apiVersion: string;
    kind: string;
    output: string;
    resourceCount: number;
    patchCount: number;
  };
}

interface ResourceInfo {
  relativePath: string;
  size: number;
  preview: string;
}

interface PatchInfo {
  index: number;
  op: string;
  include?: string[];
  exclude?: string[];
  group?: string;
  id?: string;
  details: Record<string, unknown>;
}

interface DiffResult {
  hasChanges: boolean;
  files: Array<{
    path: string;
    status: "added" | "modified" | "unchanged";
    diff?: string;
  }>;
}

/**
 * Generate the HTML for the Web UI
 */
function generateHtml(configPath: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Kustomark Web UI</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }
    .header {
      background: #16213e;
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #0f3460;
    }
    .header h1 { font-size: 1.5rem; color: #e94560; }
    .header .path { color: #888; font-size: 0.9rem; }
    .container { display: flex; height: calc(100vh - 60px); }
    .sidebar {
      width: 300px;
      background: #16213e;
      border-right: 1px solid #0f3460;
      overflow-y: auto;
    }
    .main { flex: 1; overflow-y: auto; padding: 1rem; }
    .section {
      margin-bottom: 1rem;
      border: 1px solid #0f3460;
      border-radius: 8px;
      overflow: hidden;
    }
    .section-header {
      background: #0f3460;
      padding: 0.75rem 1rem;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .section-content { padding: 1rem; }
    .btn {
      background: #e94560;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .btn:hover { background: #ff6b6b; }
    .btn:disabled { background: #666; cursor: not-allowed; }
    .btn-secondary { background: #0f3460; }
    .btn-secondary:hover { background: #1a4a7a; }
    .resource-item, .patch-item {
      padding: 0.75rem;
      border-bottom: 1px solid #0f3460;
      cursor: pointer;
    }
    .resource-item:hover, .patch-item:hover { background: #1a1a2e; }
    .resource-item:last-child, .patch-item:last-child { border-bottom: none; }
    .patch-op {
      display: inline-block;
      background: #e94560;
      color: white;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.8rem;
      margin-right: 0.5rem;
    }
    .patch-target { color: #888; font-size: 0.9rem; }
    pre {
      background: #0d1117;
      padding: 1rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .diff-add { color: #3fb950; background: rgba(63, 185, 80, 0.1); }
    .diff-remove { color: #f85149; background: rgba(248, 81, 73, 0.1); }
    .tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .tab {
      padding: 0.5rem 1rem;
      background: #0f3460;
      border: none;
      color: #eee;
      cursor: pointer;
      border-radius: 4px;
    }
    .tab.active { background: #e94560; }
    .status {
      padding: 0.5rem 1rem;
      border-radius: 4px;
      margin-bottom: 1rem;
    }
    .status.success { background: rgba(63, 185, 80, 0.2); color: #3fb950; }
    .status.error { background: rgba(248, 81, 73, 0.2); color: #f85149; }
    .status.info { background: rgba(88, 166, 255, 0.2); color: #58a6ff; }
    .lint-issue {
      padding: 0.5rem;
      margin-bottom: 0.5rem;
      border-radius: 4px;
      font-size: 0.9rem;
    }
    .lint-error { background: rgba(248, 81, 73, 0.2); border-left: 3px solid #f85149; }
    .lint-warning { background: rgba(210, 153, 34, 0.2); border-left: 3px solid #d29922; }
    .lint-info { background: rgba(88, 166, 255, 0.2); border-left: 3px solid #58a6ff; }
    .loading { text-align: center; padding: 2rem; color: #888; }
    .empty { color: #888; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Kustomark</h1>
    <span class="path">${configPath}</span>
  </div>
  <div class="container">
    <div class="sidebar">
      <div class="section">
        <div class="section-header">Resources</div>
        <div id="resources-list" class="section-content">
          <div class="loading">Loading...</div>
        </div>
      </div>
      <div class="section">
        <div class="section-header">Patches</div>
        <div id="patches-list" class="section-content">
          <div class="loading">Loading...</div>
        </div>
      </div>
    </div>
    <div class="main">
      <div class="tabs">
        <button class="tab active" data-tab="overview">Overview</button>
        <button class="tab" data-tab="config">Config</button>
        <button class="tab" data-tab="diff">Diff Preview</button>
        <button class="tab" data-tab="lint">Lint</button>
      </div>
      <div id="tab-content">
        <div class="loading">Loading...</div>
      </div>
    </div>
  </div>

  <script>
    const API_BASE = '';
    let currentTab = 'overview';
    let configData = null;
    let resourcesData = [];
    let patchesData = [];
    let lintData = null;

    async function fetchApi(endpoint) {
      const res = await fetch(API_BASE + endpoint);
      return res.json();
    }

    async function postApi(endpoint, data) {
      const res = await fetch(API_BASE + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return res.json();
    }

    async function loadConfig() {
      const result = await fetchApi('/api/config');
      if (result.success) {
        configData = result.data;
        renderOverview();
      }
    }

    async function loadResources() {
      const result = await fetchApi('/api/resources');
      if (result.success) {
        resourcesData = result.data;
        renderResourcesList();
      }
    }

    async function loadPatches() {
      const result = await fetchApi('/api/patches');
      if (result.success) {
        patchesData = result.data;
        renderPatchesList();
      }
    }

    async function loadLint() {
      const result = await fetchApi('/api/lint');
      if (result.success) {
        lintData = result.data;
      }
    }

    function renderResourcesList() {
      const el = document.getElementById('resources-list');
      if (resourcesData.length === 0) {
        el.innerHTML = '<div class="empty">No resources found</div>';
        return;
      }
      el.innerHTML = resourcesData.map(r =>
        '<div class="resource-item" onclick="showResource(\\'' + r.relativePath + '\\')">' +
        '<div>' + r.relativePath + '</div>' +
        '<div class="patch-target">' + formatBytes(r.size) + '</div>' +
        '</div>'
      ).join('');
    }

    function renderPatchesList() {
      const el = document.getElementById('patches-list');
      if (patchesData.length === 0) {
        el.innerHTML = '<div class="empty">No patches defined</div>';
        return;
      }
      el.innerHTML = patchesData.map(p =>
        '<div class="patch-item" onclick="showPatch(' + p.index + ')">' +
        '<span class="patch-op">' + p.op + '</span>' +
        (p.group ? '<span class="patch-target">[' + p.group + ']</span>' : '') +
        '</div>'
      ).join('');
    }

    function renderOverview() {
      if (!configData) return;
      const c = configData;
      document.getElementById('tab-content').innerHTML =
        '<div class="section">' +
        '<div class="section-header">Configuration Summary</div>' +
        '<div class="section-content">' +
        '<p><strong>API Version:</strong> ' + c.parsed.apiVersion + '</p>' +
        '<p><strong>Kind:</strong> ' + c.parsed.kind + '</p>' +
        '<p><strong>Output:</strong> ' + c.parsed.output + '</p>' +
        '<p><strong>Resources:</strong> ' + c.parsed.resourceCount + '</p>' +
        '<p><strong>Patches:</strong> ' + c.parsed.patchCount + '</p>' +
        '</div></div>' +
        '<div class="section">' +
        '<div class="section-header">' +
        'Actions ' +
        '<button class="btn" onclick="runBuild()">Build</button> ' +
        '<button class="btn btn-secondary" onclick="runDiff()">Diff</button>' +
        '</div>' +
        '<div class="section-content" id="action-output">' +
        '<div class="empty">Click Build or Diff to see results</div>' +
        '</div></div>';
    }

    function renderConfig() {
      if (!configData) return;
      document.getElementById('tab-content').innerHTML =
        '<div class="section">' +
        '<div class="section-header">kustomark.yaml</div>' +
        '<div class="section-content">' +
        '<pre>' + escapeHtml(configData.content) + '</pre>' +
        '</div></div>';
    }

    async function renderDiff() {
      document.getElementById('tab-content').innerHTML = '<div class="loading">Generating diff...</div>';
      const result = await fetchApi('/api/diff');
      if (!result.success) {
        document.getElementById('tab-content').innerHTML =
          '<div class="status error">' + result.error + '</div>';
        return;
      }
      const diff = result.data;
      let html = '<div class="status ' + (diff.hasChanges ? 'info' : 'success') + '">' +
        (diff.hasChanges ? 'Changes detected' : 'No changes') + '</div>';

      for (const file of diff.files) {
        if (file.status === 'unchanged') continue;
        html += '<div class="section">' +
          '<div class="section-header">' + file.path + ' (' + file.status + ')</div>' +
          '<div class="section-content"><pre>' + formatDiff(file.diff || '') + '</pre></div></div>';
      }
      document.getElementById('tab-content').innerHTML = html || '<div class="empty">No changes to show</div>';
    }

    function renderLint() {
      if (!lintData) {
        document.getElementById('tab-content').innerHTML = '<div class="loading">Loading...</div>';
        return;
      }
      let html = '<div class="status ' +
        (lintData.errorCount > 0 ? 'error' : lintData.warningCount > 0 ? 'info' : 'success') + '">' +
        lintData.errorCount + ' errors, ' + lintData.warningCount + ' warnings</div>';

      if (lintData.issues.length === 0) {
        html += '<div class="empty">No issues found</div>';
      } else {
        for (const issue of lintData.issues) {
          html += '<div class="lint-issue lint-' + issue.level + '">' + issue.message + '</div>';
        }
      }
      document.getElementById('tab-content').innerHTML = html;
    }

    async function showResource(path) {
      const result = await fetchApi('/api/resource/' + encodeURIComponent(path));
      if (result.success) {
        document.getElementById('tab-content').innerHTML =
          '<div class="section">' +
          '<div class="section-header">' + path + '</div>' +
          '<div class="section-content"><pre>' + escapeHtml(result.data.content) + '</pre></div></div>';
      }
    }

    function showPatch(index) {
      const patch = patchesData[index];
      if (!patch) return;
      document.getElementById('tab-content').innerHTML =
        '<div class="section">' +
        '<div class="section-header">Patch #' + (index + 1) + ': ' + patch.op + '</div>' +
        '<div class="section-content"><pre>' + escapeHtml(JSON.stringify(patch.details, null, 2)) + '</pre></div></div>';
    }

    async function runBuild() {
      const output = document.getElementById('action-output');
      output.innerHTML = '<div class="loading">Building...</div>';
      const result = await postApi('/api/build', {});
      if (result.success) {
        output.innerHTML = '<div class="status success">' +
          'Build complete: ' + result.data.filesWritten + ' files written, ' +
          result.data.patchesApplied + ' patches applied</div>';
      } else {
        output.innerHTML = '<div class="status error">' + result.error + '</div>';
      }
    }

    async function runDiff() {
      const output = document.getElementById('action-output');
      output.innerHTML = '<div class="loading">Generating diff...</div>';
      const result = await fetchApi('/api/diff');
      if (result.success) {
        const diff = result.data;
        let html = '<div class="status ' + (diff.hasChanges ? 'info' : 'success') + '">' +
          (diff.hasChanges ? diff.files.filter(f => f.status !== 'unchanged').length + ' files changed' : 'No changes') + '</div>';
        output.innerHTML = html;
      } else {
        output.innerHTML = '<div class="status error">' + result.error + '</div>';
      }
    }

    function switchTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelector('.tab[data-tab="' + tab + '"]').classList.add('active');

      switch(tab) {
        case 'overview': renderOverview(); break;
        case 'config': renderConfig(); break;
        case 'diff': renderDiff(); break;
        case 'lint': renderLint(); break;
      }
    }

    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function formatDiff(diff) {
      return diff.split('\\n').map(line => {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          return '<span class="diff-add">' + escapeHtml(line) + '</span>';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          return '<span class="diff-remove">' + escapeHtml(line) + '</span>';
        }
        return escapeHtml(line);
      }).join('\\n');
    }

    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Initial load
    Promise.all([loadConfig(), loadResources(), loadPatches(), loadLint()]);
  </script>
</body>
</html>`;
}

/**
 * Start the web UI server
 */
export async function startWebServer(config: WebServerConfig): Promise<void> {
  const { port, configPath } = config;
  const resolvedConfigPath = resolve(configPath);

  if (!existsSync(resolvedConfigPath)) {
    throw new Error(`Config file not found: ${resolvedConfigPath}`);
  }

  const configDir = dirname(resolvedConfigPath);

  console.log(`Starting Kustomark Web UI...`);
  console.log(`Config: ${resolvedConfigPath}`);
  console.log(`Server: http://localhost:${port}`);
  console.log(`\nPress Ctrl+C to stop\n`);

  Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // CORS headers for API
      const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      };

      if (req.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
      }

      try {
        // API endpoints
        if (path === "/api/config") {
          const content = await readFile(resolvedConfigPath, "utf-8");
          const parsed = await loadConfigFile(resolvedConfigPath);
          const response: ApiResponse<ConfigInfo> = {
            success: true,
            data: {
              path: resolvedConfigPath,
              content,
              parsed: {
                apiVersion: parsed.apiVersion,
                kind: parsed.kind,
                output: parsed.output,
                resourceCount: parsed.resources.length,
                patchCount: parsed.patches?.length || 0,
              },
            },
          };
          return Response.json(response, { headers: corsHeaders });
        }

        if (path === "/api/resources") {
          const parsed = await loadConfigFile(resolvedConfigPath);
          const resources = await resolveResources(resolvedConfigPath, parsed.resources);
          const response: ApiResponse<ResourceInfo[]> = {
            success: true,
            data: resources.map((r) => ({
              relativePath: r.relativePath,
              size: Buffer.byteLength(r.content, "utf-8"),
              preview: r.content.substring(0, 200),
            })),
          };
          return Response.json(response, { headers: corsHeaders });
        }

        if (path.startsWith("/api/resource/")) {
          const resourcePath = decodeURIComponent(path.slice("/api/resource/".length));
          const parsed = await loadConfigFile(resolvedConfigPath);
          const resources = await resolveResources(resolvedConfigPath, parsed.resources);
          const resource = resources.find((r) => r.relativePath === resourcePath);
          if (resource) {
            return Response.json(
              { success: true, data: { content: resource.content } },
              { headers: corsHeaders }
            );
          }
          return Response.json(
            { success: false, error: "Resource not found" },
            { status: 404, headers: corsHeaders }
          );
        }

        if (path === "/api/patches") {
          const parsed = await loadConfigFile(resolvedConfigPath);
          const patches = parsed.patches ? resolveExtends(parsed.patches) : [];
          const response: ApiResponse<PatchInfo[]> = {
            success: true,
            data: patches.map((p, i) => ({
              index: i,
              op: p.op,
              include: p.include,
              exclude: p.exclude,
              group: p.group,
              id: p.id,
              details: p as unknown as Record<string, unknown>,
            })),
          };
          return Response.json(response, { headers: corsHeaders });
        }

        if (path === "/api/lint") {
          const parsed = await loadConfigFile(resolvedConfigPath);
          const resources = await resolveResources(resolvedConfigPath, parsed.resources);
          const result = lintConfig(parsed, resources);
          return Response.json({ success: true, data: result }, { headers: corsHeaders });
        }

        if (path === "/api/diff") {
          const parsed = await loadConfigFile(resolvedConfigPath);
          const resources = await resolveResources(resolvedConfigPath, parsed.resources);
          const patches = parsed.patches ? resolveExtends(parsed.patches) : [];
          const outputDir = resolve(configDir, parsed.output);

          const files: DiffResult["files"] = [];
          let hasChanges = false;

          for (const resource of resources) {
            const patchResult = applyPatches(resource.content, patches, resource.relativePath, {});
            const outputPath = join(outputDir, resource.relativePath);

            let existingContent = "";
            let status: "added" | "modified" | "unchanged" = "added";

            if (existsSync(outputPath)) {
              existingContent = await readFile(outputPath, "utf-8");
              status = existingContent === patchResult.content ? "unchanged" : "modified";
            }

            if (status !== "unchanged") {
              hasChanges = true;
              const diff = Diff.createPatch(
                resource.relativePath,
                existingContent,
                patchResult.content,
                "existing",
                "new"
              );
              files.push({ path: resource.relativePath, status, diff });
            } else {
              files.push({ path: resource.relativePath, status });
            }
          }

          const response: ApiResponse<DiffResult> = {
            success: true,
            data: { hasChanges, files },
          };
          return Response.json(response, { headers: corsHeaders });
        }

        if (path === "/api/build" && req.method === "POST") {
          const parsed = await loadConfigFile(resolvedConfigPath);
          const resources = await resolveResources(resolvedConfigPath, parsed.resources);
          const patches = parsed.patches ? resolveExtends(parsed.patches) : [];
          const outputDir = resolve(configDir, parsed.output);

          let filesWritten = 0;
          let patchesApplied = 0;

          for (const resource of resources) {
            const patchResult = applyPatches(resource.content, patches, resource.relativePath, {});
            const outputPath = join(outputDir, resource.relativePath);

            await Bun.write(outputPath, patchResult.content);
            filesWritten++;
            patchesApplied += patchResult.applied;
          }

          return Response.json(
            { success: true, data: { filesWritten, patchesApplied } },
            { headers: corsHeaders }
          );
        }

        // Serve HTML for root
        if (path === "/" || path === "/index.html") {
          return new Response(generateHtml(resolvedConfigPath), {
            headers: { "Content-Type": "text/html" },
          });
        }

        return new Response("Not Found", { status: 404 });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        return Response.json(
          { success: false, error: errorMsg },
          { status: 500, headers: corsHeaders }
        );
      }
    },
  });

  // Keep the server running
  await new Promise(() => {});
}
