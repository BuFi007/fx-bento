import * as React from "react";

import { listTools } from "@bufinance/fx-bento-mcp";

export function FxArcadeDashboard() {
  return (
    <main className="fx-shell">
      <section className="fx-band">
        <h1>FX² Arcade Protocol</h1>
        <p>Play FX Bento</p>
      </section>
      <section className="fx-grid">
        <Panel title="Arcade Lobby">
          <p>FX Bento room list, waiting room presence, game board, and leaderboard placeholders.</p>
        </Panel>
        <Panel title="Perps">
          <p>Market list, quote panel, position preview, funding, and liquidation data placeholders.</p>
        </Panel>
        <Panel title="FX Telaraña">
          <p>Lending markets, borrow quote, and wallet position placeholders.</p>
        </Panel>
        <Panel title="MCP Workflow Console">
          <ul>
            {listTools().slice(0, 6).map((tool) => (
              <li key={tool.name}>{tool.name}</li>
            ))}
          </ul>
        </Panel>
      </section>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fx-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
