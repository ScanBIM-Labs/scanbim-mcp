-- Revit MCP - D1 Database Schema
-- Tracks model uploads, conversions, and usage

CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_url TEXT,
    format TEXT NOT NULL,
    tier TEXT NOT NULL DEFAULT 'free',
    project_name TEXT DEFAULT 'default',
    status TEXT DEFAULT 'uploaded',
    viewer_url TEXT,
    element_count INTEGER,
    file_size_bytes INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS clash_reports (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    category_a TEXT NOT NULL,
    category_b TEXT NOT NULL,
    clash_count INTEGER,
    critical_count INTEGER,
    report_json TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (model_id) REFERENCES models(id)
);

CREATE TABLE IF NOT EXISTS usage_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_name TEXT NOT NULL,
    model_id TEXT,
    user_agent TEXT,
    ip_hash TEXT,
    created_at TEXT NOT NULL
);

-- Model Coordination views (saved discipline filters/view configurations)
CREATE TABLE IF NOT EXISTS coordination_views (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    project_id TEXT,
    model_id TEXT,
    disciplines TEXT,            -- JSON array of discipline names
    categories TEXT,             -- JSON array of Revit/IFC categories
    is_builtin INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

-- Clash groups per project (named pairs of categories for recurring clash runs)
CREATE TABLE IF NOT EXISTS clash_groups (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category_a TEXT NOT NULL,
    category_b TEXT NOT NULL,
    tolerance_mm REAL DEFAULT 0,
    clash_type TEXT DEFAULT 'hard',  -- hard, soft, clearance
    priority TEXT DEFAULT 'medium',  -- critical, high, medium, low
    created_at TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_models_format ON models(format);
CREATE INDEX IF NOT EXISTS idx_models_project ON models(project_name);
CREATE INDEX IF NOT EXISTS idx_models_created ON models(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_tool ON usage_log(tool_name);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_coord_views_project ON coordination_views(project_id);
CREATE INDEX IF NOT EXISTS idx_coord_views_model ON coordination_views(model_id);
CREATE INDEX IF NOT EXISTS idx_clash_groups_project ON clash_groups(project_id);
