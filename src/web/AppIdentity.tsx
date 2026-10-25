import { publicAsset } from './assets.js';

export function ProviderLogos() {
  return (
    <div className="hackathon-banner" aria-label="Nebius x NVIDIA Global AI Hackathon">
      <img
        src={publicAsset('brands/nebius-nvidia-hackathon.png')}
        alt="Nebius x NVIDIA Global AI Hackathon — Build the next frontier of AI on open infrastructure"
        width="1200"
        height="160"
      />
    </div>
  );
}

export function AppAccessNote() {
  return (
    <aside className="app-access-note" aria-label="Website and terminal versions">
      <p>
        <strong>Play online or run locally.</strong> Free browser games and saved Nemotron
        recordings work here. Nebius Token Factory hosted NVIDIA Nemotron Nano and Super for the
        7,104-episode evaluation. Launch the same app from your terminal to explicitly start live
        play through Token Factory.
      </p>
      <details>
        <summary>Run locally for live API play</summary>
        <p>
          Clone the repository, copy <code>.env.example</code> to <code>.env</code>, and set your
          own <code>NEBIUS_API_KEY</code> there. Then run:
        </p>
        <pre>
          <code>{'npm ci\nnpm run build\nnpm start'}</code>
        </pre>
        <p>
          Open <code>http://127.0.0.1:4317</code>. Your key stays on the local server. Live model
          requests use your Nebius account and can incur charges.
        </p>
        <a href="https://github.com/sheinkmana/dilemma-dynamics#run-locally">
          Repository and setup guide →
        </a>
      </details>
    </aside>
  );
}
