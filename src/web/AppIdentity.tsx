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
        <strong>Same app, two ways to run.</strong> The website and terminal versions share free
        games, lessons, analysis, Study replay and Results. For live NVIDIA Nemotron API calls
        through Nebius, launch the app locally from the terminal.
      </p>
      <p>
        This website is static: putting a paid API key in browser code would expose it to visitors.
        The local app keeps your key on its localhost server, so live API play stays there. The
        website uses free browser bots and saved study recordings.
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
        <a href="https://github.com/sheinkmana/dilemma-dynamics#run">
          Repository and setup guide →
        </a>
      </details>
    </aside>
  );
}
