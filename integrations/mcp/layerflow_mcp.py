"""Optional MCP adapter: exposes one LayerFlow workspace to MCP clients (Claude Desktop, IDEs, other agents).

It is a thin layer over the public API (via the Python SDK), so it only sees what its API key's scopes allow.
LayerFlow itself does not depend on MCP.

    pip install "./packages/sdk-python[mcp]"
    LAYERFLOW_URL=https://agents.example.com LAYERFLOW_API_KEY=lf_pk_... python integrations/mcp/layerflow_mcp.py

Claude Desktop config (claude_desktop_config.json):
    { "mcpServers": { "layerflow": { "command": "python", "args": ["/path/to/integrations/mcp/layerflow_mcp.py"],
      "env": { "LAYERFLOW_URL": "https://agents.example.com", "LAYERFLOW_API_KEY": "lf_pk_..." } } } }
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

from layerflow import LayerFlow

lf = LayerFlow(os.environ["LAYERFLOW_URL"], os.environ["LAYERFLOW_API_KEY"])
mcp = FastMCP("layerflow")


@mcp.tool()
def list_content(limit: int = 10, tag: str | None = None) -> dict:
    """List the workspace's latest published content (articles, posts). Needs content:read."""
    return lf.content.list(limit=limit, tag=tag)


@mcp.tool()
def search_dataset(dataset: str, query: str | None = None, limit: int = 20, sort: str | None = None) -> dict:
    """Search records of a public dataset, e.g. dataset="colleges", sort="nirf_rank:asc". Needs datasets:read."""
    return lf.datasets.records(dataset, q=query, limit=limit, sort=sort)


@mcp.tool()
def ask_assistant(message: str, dataset: str) -> dict:
    """Ask the comparison assistant about a dataset (returns answer + comparison table). Needs assistant:chat."""
    return lf.chat(message, dataset=dataset)


@mcp.tool()
def run_workflow(pipeline_id: str, url: str | None = None, text: str | None = None, wait: bool = True) -> dict:
    """Start a LayerFlow workflow with an optional URL/text input; waits up to 10 minutes. Needs runs:write + runs:read."""
    return lf.workflows.run(pipeline_id, input={"url": url, "text": text}, wait=wait)


@mcp.tool()
def get_run(run_id: str) -> dict:
    """Get the status and output of a run. Needs runs:read."""
    return lf.runs.get(run_id)


if __name__ == "__main__":
    mcp.run()
