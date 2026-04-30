import { getSiteConfig } from "../local/site-config";

export function Impressum() {
  const { imprint } = getSiteConfig();

  if (!imprint) {
    return <UnconfiguredImprint />;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8 text-ink">
      <h1 className="font-display text-2xl font-semibold">Impressum</h1>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          Angaben gemäß § 5 DDG / § 18 MStV
        </h2>
        <address className="not-italic leading-relaxed">
          {imprint.name}
          <br />
          {imprint.addressLine1}
          <br />
          {imprint.addressLine2}
          {imprint.country && (
            <>
              <br />
              {imprint.country}
            </>
          )}
        </address>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          Kontakt
        </h2>
        <p>
          E-Mail:{" "}
          <a
            href={`mailto:${imprint.email}`}
            className="underline hover:text-hot"
          >
            {imprint.email}
          </a>
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          Verantwortlich i.S.d. § 18 Abs. 2 MStV
        </h2>
        <p>{imprint.name}, Anschrift wie oben.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          Haftungsausschluss
        </h2>
        <p className="leading-relaxed">
          Diese Anwendung wird ohne Gewähr und ohne Anspruch auf Verfügbarkeit
          bereitgestellt. Die Verarbeitung Ihrer Mediendateien erfolgt
          vollständig im Browser; eine Haftung für Datenverlust, fehlerhafte
          Sync-Ergebnisse oder Inkompatibilitäten mit einzelnen Endgeräten ist
          ausgeschlossen, soweit gesetzlich zulässig.
        </p>
        <p className="leading-relaxed">
          Für die Inhalte externer, von dieser Seite verlinkter Webseiten ist
          ausschließlich der jeweilige Anbieter verantwortlich.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          Verwendete Open-Source-Komponenten
        </h2>
        <ul className="list-disc space-y-1 pl-5 leading-relaxed">
          <li>
            FFmpeg (LGPL v2.1+) —{" "}
            <a
              href="https://ffmpeg.org"
              className="underline hover:text-hot"
              target="_blank"
              rel="noreferrer"
            >
              ffmpeg.org
            </a>
          </li>
          <li>
            ffmpeg.wasm (MIT) —{" "}
            <a
              href="https://github.com/ffmpegwasm/ffmpeg.wasm"
              className="underline hover:text-hot"
              target="_blank"
              rel="noreferrer"
            >
              github.com/ffmpegwasm/ffmpeg.wasm
            </a>
          </li>
          <li>React, Vite, TailwindCSS, zustand, idb, mp4-muxer (MIT / Apache-2.0)</li>
          <li>Eigene Sync-Engine in Rust (WebAssembly)</li>
        </ul>
        <p className="leading-relaxed">
          Die im Browser ausgeführten FFmpeg-Bibliotheken stehen unter der
          LGPL. Der unveränderte Quellcode ist unter dem oben genannten Link
          verfügbar.
        </p>
      </section>
    </main>
  );
}

function UnconfiguredImprint() {
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8 text-ink">
      <h1 className="font-display text-2xl font-semibold">Impressum</h1>
      <section className="border-l-2 border-danger pl-3 py-2 space-y-3 text-sm font-mono leading-relaxed text-ink">
        <p className="text-danger uppercase tracking-label text-xs">
          ⚠ Imprint not configured
        </p>
        <p>
          This deployment is missing its <code>VITE_IMPRESSUM_*</code>{" "}
          build-time environment variables, so the legal imprint cannot be
          rendered. The site operator must configure them before publishing
          this instance.
        </p>
        <p>
          See <code>.env.example</code> at the repository root and the{" "}
          <em>Configuring your instance</em> section in the README.
        </p>
      </section>
    </main>
  );
}

export default Impressum;
