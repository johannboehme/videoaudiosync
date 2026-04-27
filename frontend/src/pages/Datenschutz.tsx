import { Link } from "react-router-dom";

export function Datenschutz() {
  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8 text-ink">
      <h1 className="font-display text-2xl font-semibold">
        Datenschutzerklärung
      </h1>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          1. Verantwortlicher
        </h2>
        <p className="leading-relaxed">
          Verantwortlicher im Sinne der DSGVO ist die im{" "}
          <Link to="/impressum" className="underline hover:text-hot">
            Impressum
          </Link>{" "}
          genannte Person.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          2. Server-Logs
        </h2>
        <p className="leading-relaxed">
          Beim Aufruf dieser Seite werden vom Webserver folgende Daten
          verarbeitet: IP-Adresse, Datum und Uhrzeit der Anfrage, abgerufene
          URL, Referrer und User-Agent. Die IP-Adresse wird vor der Speicherung
          anonymisiert (das letzte Oktett bei IPv4 bzw. die letzten 80 Bit bei
          IPv6 werden durch Nullen ersetzt).
        </p>
        <p className="leading-relaxed">
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO (berechtigtes
          Interesse an der technisch fehlerfreien Bereitstellung). Die
          Speicherdauer beträgt maximal 7 Tage; danach werden die Logs
          automatisch gelöscht. Eine Zusammenführung dieser Daten mit anderen
          Datenquellen findet nicht statt.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          3. Verarbeitung Ihrer Mediendateien
        </h2>
        <p className="leading-relaxed">
          Sämtliche Verarbeitung Ihrer Video- und Audiodateien geschieht
          ausschließlich in Ihrem Browser (über WebAssembly bzw. WebCodecs).
          Die Dateien verlassen Ihr Endgerät zu keinem Zeitpunkt; es findet
          kein Upload an einen Server statt. Es findet daher auch keine
          Verarbeitung dieser Inhalte durch den Anbieter statt.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          4. Lokale Speicherung im Browser
        </h2>
        <p className="leading-relaxed">
          Die Anwendung nutzt das Origin Private File System (OPFS) sowie
          IndexedDB Ihres Browsers, um Jobs, Zwischenstände und Renderings
          lokal zu speichern. Diese Daten verbleiben ausschließlich in Ihrem
          Browser; sie können jederzeit über die Seite „History" einzeln oder
          insgesamt gelöscht werden.
        </p>
        <p className="leading-relaxed">
          Es werden keine Cookies und kein Tracking eingesetzt. Es kommen
          keine Analyse-, Werbe- oder Profiling-Dienste zum Einsatz.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          5. Schriften (Web Fonts)
        </h2>
        <p className="leading-relaxed">
          Die verwendeten Schriftarten werden ausschließlich vom eigenen
          Server ausgeliefert. Es werden keine Schriften von Drittanbietern
          (z.B. Google Fonts) nachgeladen.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          6. Cross-Origin-Isolation (COOP / COEP)
        </h2>
        <p className="leading-relaxed">
          Aus technischen Gründen (WebAssembly Threads, SharedArrayBuffer)
          setzt die Seite Cross-Origin-Opener-Policy- und
          Cross-Origin-Embedder-Policy-Header. Diese betreffen ausschließlich
          den Sicherheitskontext im Browser und führen zu keiner
          Datenübertragung an Dritte.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-sm uppercase tracking-label text-ink-2">
          7. Ihre Rechte
        </h2>
        <p className="leading-relaxed">
          Sie haben gegenüber dem Verantwortlichen das Recht auf Auskunft
          (Art. 15 DSGVO), Berichtigung (Art. 16), Löschung (Art. 17),
          Einschränkung der Verarbeitung (Art. 18), Datenübertragbarkeit
          (Art. 20) und Widerspruch (Art. 21). Bitte richten Sie entsprechende
          Anfragen an die im Impressum genannte Kontaktadresse.
        </p>
        <p className="leading-relaxed">
          Sie haben außerdem das Recht, sich bei einer Datenschutz-
          Aufsichtsbehörde zu beschweren. Zuständig ist das Bayerische
          Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522
          Ansbach.
        </p>
      </section>
    </main>
  );
}

export default Datenschutz;
