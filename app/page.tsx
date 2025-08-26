"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Tesseract from "tesseract.js";

/* ---------- UUID compatible mobile (remplace crypto.randomUUID) ---------- */
function uuidv4() {
  function makeSourceKey(f: File) {
  return `${f.name.toLowerCase()}__${f.size}__${f.lastModified}`;
}

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ---------- Types ---------- */
type Ticket = {
  id: string;
  fileName: string;
  preview?: string;
  text: string;
  provider: string;
  type: "CARTE" | "CONNECT" | "INCONNU";
  amount: number | null;
  date: string | null;
  confidence: number; // 0..5
  status: "pending" | "done" | "error";
  duplicate?: boolean;     // si doublon détecté
  sourceKey?: string;      // clé unique basée sur le fichier
  auth?: string | null;        // NEW : n° d’autorisation extrait
};


/* ======================================================================= */

export default function Home() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({
    done: 0,
    total: 0,
  });

  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);

  const selectPhotos = () => fileRef.current?.click();
  const selectFolder = () => folderRef.current?.click();

  /* ---- Charger une première fois depuis localStorage ---- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("tickets");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setTickets(parsed);
      }
    } catch {}
  }, []);

  /* ---- Sauvegarder à chaque changement ---- */
  useEffect(() => {
    try {
      localStorage.setItem("tickets", JSON.stringify(tickets));
    } catch {}
  }, [tickets]);

  /* ---- Statistiques simples ---- */
  const stats = useMemo(() => {
    const total = tickets.length;
    const done = tickets.filter((t) => t.status === "done").length;
    const pending = tickets.filter((t) => t.status === "pending").length;
    const errors = tickets.filter((t) => t.status === "error").length;

    const confidences = tickets
      .map((t) => Number(t.confidence))
      .filter((n) => !Number.isNaN(n));
    const avgConfidence =
      confidences.length > 0
        ? Math.round(
            (confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100
          ) / 100
        : null;

    const byType = {
      CARTE: tickets.filter((t) => t.type === "CARTE").length,
      CONNECT: tickets.filter((t) => t.type === "CONNECT").length,
      INCONNU: tickets.filter((t) => t.type === "INCONNU").length,
    };

    const providerMap = new Map<string, { count: number; total: number }>();
    tickets.forEach((t) => {
      const key = t.provider || "—";
      const e = providerMap.get(key) ?? { count: 0, total: 0 };
      e.count += 1;
      e.total += t.amount ?? 0;
      providerMap.set(key, e);
    });
    const byProvider = Array.from(providerMap.entries()).sort(
      (a, b) => b[1].count - a[1].count
    );

    return { total, done, pending, errors, avgConfidence, byType, byProvider };
  }, [tickets]);

  const clearAll = () => setTickets([]);

  /* ---- Import d’images (photos, dossier, drag&drop) ---- */
  const onFilesPicked = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    // Filtrer images uniquement
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

    // Empile des entrées "pending"
    const initial: Ticket[] = files.map((f) => ({
      id: uuidv4(),
      fileName: f.name,
      preview: URL.createObjectURL(f),
      text: "",
      provider: "—",
      type: "INCONNU",
      amount: null,
      date: null,
      confidence: 0,
      status: "pending",
    }));

    setTickets((prev) => [...initial, ...prev]);
    setRunning(true);
    setProgress({ done: 0, total: files.length });

    // OCR séquentiel
    for (const [idx, file] of files.entries()) {
      try {
        const { data } = await Tesseract.recognize(file, "fra", {
  logger: () => {},
  workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/worker.min.js",
  corePath:
    "https://cdn.jsdelivr.net/npm/tesseract.js-core@4/tesseract-core.wasm.js",
  langPath: "https://tessdata.projectnaptha.com/4.0.0_best",
});


        const text = (data.text || "").replace(/\s+/g, " ").trim();
        const parsed = parseTicketFromText(text);

        setTickets((prev) => {
  // doublon si même n° d’autorisation déjà présent en "done"
  const isDup =
    !!parsed.auth &&
    prev.some(
      p => p.status === "done" && p.auth && p.auth === parsed.auth && p.fileName !== file.name
    );

  return prev.map((t) =>
    t.fileName === file.name && t.status === "pending"
      ? {
          ...t,
          text,
          provider: parsed.provider,
          type: parsed.type,
          amount: parsed.amount,
          date: parsed.date,
          confidence: parsed.confidence,
          auth: parsed.auth ?? null,   // NEW
          duplicate: isDup,            // NEW
          status: "done",
        }
      : t
  );
});

      } catch (e) {
        console.error("OCR error:", e);
        setTickets((prev) =>
          prev.map((t) =>
            t.fileName === file.name && t.status === "pending"
              ? { ...t, text: "Erreur OCR", status: "error" }
              : t
          )
        );
      } finally {
        setProgress({ done: idx + 1, total: files.length });
      }
    }

    setRunning(false);
  };

  const onDrop = useCallback((ev: React.DragEvent) => {
    ev.preventDefault();
    const dt = ev.dataTransfer;
    if (dt.items) {
      const files: File[] = [];
      for (const item of Array.from(dt.items)) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      onFilesPicked({
        length: files.length,
        item: (i: number) => files[i],
        [Symbol.iterator]: function* () {
          for (const f of files) yield f;
        },
      } as unknown as FileList);
    } else {
      onFilesPicked(dt.files);
    }
  }, []);

  const prevent = (ev: React.DragEvent) => ev.preventDefault();

  const exportCSV = () => {
    const ready = tickets.filter((t) => t.status === "done");
    if (ready.length === 0) return;
    const header = "fichier;type;prestataire;montant;date;confiance\n";
    const rows = ready
      .map((t) =>
        [
          t.fileName,
          t.type,
          t.provider,
          t.amount !== null ? t.amount.toFixed(2).replace(".", ",") : "",
          t.date ?? "",
          t.confidence,
        ].join(";")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tickets_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ----------------------------- UI ----------------------------- */
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6">
          <h1 className="text-2xl font-bold">Tickets Restau Hub</h1>
          <p className="text-sm text-gray-400">
            Scanne des tickets en photo, ou importe un dossier d’images. Aucune saisie manuelle.
          </p>
        </header>

        {/* Inputs cachés */}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          capture="environment"
          onChange={(e) => onFilesPicked(e.target.files)}
          style={{ display: "none" }}
        />
        {/* NB: webkitdirectory fonctionne sur Chrome/Edge */}
        <input
          ref={folderRef}
          type="file"
          multiple
          // @ts-ignore
          webkitdirectory="true"
          // @ts-ignore
          directory="true"
          onChange={(e) => onFilesPicked(e.target.files)}
          style={{ display: "none" }}
        />

        {/* Zone d’actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <button
            onClick={selectPhotos}
            className="rounded-2xl border border-gray-700 bg-gray-800 hover:bg-gray-750 py-4 px-4 text-left"
          >
            <div className="text-lg font-semibold mb-1">Scanner des photos</div>
            <div className="text-sm text-gray-400">
              Prendre/choisir une ou plusieurs images de tickets.
            </div>
          </button>

          <button
            onClick={selectFolder}
            className="rounded-2xl border border-gray-700 bg-gray-800 hover:bg-gray-750 py-4 px-4 text-left"
          >
            <div className="text-lg font-semibold mb-1">Importer un dossier</div>
            <div className="text-sm text-gray-400">
              Sélectionne un dossier complet (Chrome/Edge recommandé).
            </div>
          </button>

          <div
            onDrop={onDrop}
            onDragOver={prevent}
            onDragEnter={prevent}
            className="rounded-2xl border-2 border-dashed border-gray-700 bg-gray-800/60 py-4 px-4"
          >
            <div className="text-lg font-semibold mb-1">Glisser-déposer</div>
            <div className="text-sm text-gray-400">Dépose ici des images (jpg, png, heic...).</div>
          </div>
        </div>

        {/* Progression */}
        {running && (
          <div className="mb-6">
            <p className="text-sm text-gray-300 mb-2">
              Lecture OCR… {progress.done}/{progress.total}
            </p>
            <div className="h-2 w-full bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-2 bg-indigo-500"
                style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Résultats récents (cartes) */}
        {tickets.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
            {tickets.slice(0, 6).map((t) => (
              <div key={t.id} className="rounded-2xl border border-gray-700 bg-gray-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold truncate">{t.fileName}</div>
                  <span
  className={`text-xs px-2 py-0.5 rounded-full ${
    t.duplicate
      ? "bg-yellow-700/40 text-yellow-300"
      : t.status === "done"
      ? "bg-green-700/40 text-green-300"
      : t.status === "error"
      ? "bg-red-700/40 text-red-300"
      : "bg-gray-700 text-gray-300"
  }`}
>
  {t.duplicate ? "doublon" : t.status}
</span>

                </div>
                {t.preview && (
                  <div className="mb-3 overflow-hidden rounded-lg border border-gray-700">
                    <img src={t.preview} alt={t.fileName} className="w-full max-h-52 object-contain bg-black" />
                  </div>
                )}
                <div className="text-sm leading-6">
                  <div><span className="text-gray-400">Type :</span> {t.type}</div>
                  <div><span className="text-gray-400">Prestataire :</span> {t.provider}</div>
                  <div><span className="text-gray-400">Montant :</span> {t.amount !== null ? `${t.amount.toFixed(2)} €` : "—"}</div>
                  <div><span className="text-gray-400">Date :</span> {t.date ?? "—"}</div>
                  <div className="text-yellow-400">{"★".repeat(t.confidence)}{"☆".repeat(5 - t.confidence)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Panel stats + actions */}
        <div className="mb-4 rounded-xl border border-gray-700 bg-gray-800/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm sm:text-base">
              <div className="font-semibold text-white">
                Tickets : <span className="text-indigo-300">{stats.total}</span>
              </div>
              <div className="mt-1 text-gray-300">
                <span className="mr-3">✅ Terminés : <span className="text-green-400">{stats.done}</span></span>
                <span className="mr-3">⏳ En attente : <span className="text-yellow-300">{stats.pending}</span></span>
                <span>⚠️ Erreurs : <span className="text-red-400">{stats.errors}</span></span>
                {stats.avgConfidence !== null && (
                  <span className="ml-3">★ Confiance moy. : <span className="text-sky-300">{stats.avgConfidence}</span></span>
                )}
              </div>
            </div>

            <div className="flex gap-2">
              <button
                className="rounded-lg bg-gray-700 px-3 py-2 text-sm text-gray-100 hover:bg-gray-600"
                onClick={clearAll}
                title="Effacer l'historique local"
              >
                Vider
              </button>
              {/* <button className="rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50" onClick={exportCSV} disabled={stats.done === 0}>Exporter CSV</button> */}
            </div>
          </div>
        </div>

        {/* Tableau récap + export CSV */}
        <div className="rounded-2xl border border-gray-700 bg-gray-800">
          <div className="flex items-center justify-between p-4">
            <h2 className="text-lg font-semibold">Historique OCR</h2>
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded-xl border border-gray-600 hover:bg-gray-700" onClick={() => setTickets([])}>Vider</button>
              <button className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed" onClick={exportCSV} disabled={tickets.filter((t) => t.status === "done").length === 0}>Exporter CSV</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-300 border-b border-gray-700">
                  <th className="py-2 px-4">Fichier</th>
                  <th className="py-2 px-4">Type</th>
                  <th className="py-2 px-4">Prestataire</th>
                  <th className="py-2 px-4">Montant (€)</th>
                  <th className="py-2 px-4">Date</th>
                  <th className="py-2 px-4">Confiance</th>
                  <th className="py-2 px-4">Statut</th>
                </tr>
              </thead>
              <tbody>
               {tickets
  .filter((t) => !t.duplicate)   // 🚫 on n’affiche pas les doublons
  .map((t) => (
    <tr key={t.id} className="border-b border-gray-800">
      <td className="py-2 px-4 truncate max-w-[220px]">{t.fileName}</td>
      <td className="py-2 px-4">{t.type}</td>
      <td className="py-2 px-4">{t.provider}</td>
      <td className="py-2 px-4">{t.amount !== null ? t.amount.toFixed(2) : ""}</td>
      <td className="py-2 px-4">{t.date ?? ""}</td>
      <td className="py-2 px-4">
        {"★".repeat(t.confidence)}
        {"☆".repeat(5 - t.confidence)}
      </td>
      <td className="py-2 px-4">{t.status}</td>
    </tr>
))}

              </tbody>
            </table>
          </div>
        </div>

        <footer className="text-xs text-gray-500 mt-6">
          Astuce : pour importer un dossier complet, utilise <b>Chrome</b> ou <b>Edge</b> (attribut <code>webkitdirectory</code>).
        </footer>
      </div>
    </div>
  );
}

/* ===================== Parsing du texte OCR ===================== */

/** Normalisations très simples pour aider les regex */

function fixDigitsToken(tok: string) {
  if (!/^[0-9A-Za-z/:\.\-]+$/.test(tok)) return tok;
  return tok
    .replace(/[Oo]/g, "0")
    .replace(/[Q]/g, "0")
    .replace(/[Ss]/g, "5")
    .replace(/[Il|]/g, "1")
    .replace(/[B]/g, "8")
    .replace(/[Z]/g, "2");
}

function normalizeOCR(raw: string) {
  const tokens = raw.split(/\s+/).map(fixDigitsToken);
  let s = tokens.join(" ");
  s = s.replace(/(\d)\s*,\s*(\d{2})/g, "$1,$2");
  s = s.replace(/(\d)\s*\.\s*(\d{2})/g, "$1.$2");
  s = s.replace(/\s+[AÀ@]\s+/gi, " A ");
  s = s.replace(/[ \t]+/g, " ");
  return s;
}

function hasKeywordNear(s: string, keyword: RegExp, index: number, before = 10, after = 10) {
  const start = Math.max(0, index - before);
  const end = Math.min(s.length, index + after);
  return keyword.test(s.slice(start, end));
}

function parseTicketFromText(text: string) {
  // Normalisation simple (pas d’appel externe)
  const normalized = text.replace(/[^\S\r\n]+/g, " ");
  const upper = normalized.toUpperCase();
  const upperDigits = upper;

  // --- Type & Provider ---
  const hasTRWords = /\b(TITRE\S*RESTAURANT|TICKET\S*RESTAURANT|CONECS)\b/.test(upper);
  const isCard = /\b(VISA|MASTERCARD|CB|EMV|CONTACTLESS|SANS\s*CONTACT)\b/.test(upper);
  const isConnect = /\b(EDENRED|TICKET\s*RESTAURANT|PLUXEE|SODEXO|SWILE|BIMPLI|APETIZ|UP(?:\s*D[ÉE]JEUNER)?|CH[ÈE]QUE\s*D[ÉE]JEUNER|\bTR\b)\b/.test(upper);

  let provider = "—";
  if (/\bEDENRED|TICKET\s*RESTAURANT\b/.test(upper)) provider = "Edenred / Ticket Restaurant (Connect)";
  else if (/\bCONECS\b/.test(upper)) provider = "Conecs (Connect)";
  else if (/\bPLUXEE|SODEXO\b/.test(upper)) provider = "Pluxee (Connect)";
  else if (/\bSWILE\b/.test(upper)) provider = "Swile (Connect)";
  else if (/\bBIMPLI|APETIZ\b/.test(upper)) provider = "Bimpli (Connect)";
  else if (/\bUP(?:\s*D[ÉE]JEUNER)?|CH[ÈE]QUE\s*D[ÉE]JEUNER\b/.test(upper)) provider = "Up Déjeuner (Connect)";
  else if (isCard && hasTRWords) provider = "TR Mastercard (carte)";
  else if (isCard) provider = "Inconnu (rails bancaires)";

  // --- Montant ---
  let amount: number | null = null;
  // 1) “MONTANT … 25,00 €” prioritaire
  const m1 = normalized.match(/MONTANT[^\d]{0,12}(\d+\s?[.,]\s?\d{2})\s*(€|EUR)?/i);
  if (m1) {
    amount = parseFloat(m1[1].replace(/\s/g, "").replace(",", "."));
  } else {
    // 2) fallback : prendre le plus grand montant plausible
    const reAmt = /(\d{1,4}\s?[.,]\s?\d{2})\s*(€|EUR)?/gi;
    const vals: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = reAmt.exec(normalized)) !== null) {
      vals.push(parseFloat(m[1].replace(/\s/g, "").replace(",", ".")));
    }
    if (vals.length) {
      vals.sort((a, b) => b - a);
      amount = vals[0];
    }
  }

  // --- Date ---
  let date: string | null = null;
  const dateRe = /\b(0?\d|[12]\d|3[01])\s*[/\-.]\s*(0?\d|1[0-2])\s*[/\-.]\s*(\d{2}|\d{4})\b/gi;
  type Found = { idx: number; d: string };
  const found: Found[] = [];
  {
    let dm: RegExpExecArray | null;
    while ((dm = dateRe.exec(upper)) !== null) {
      const idx = dm.index;
      const dd = dm[1].toString().padStart(2, "0");
      const mm = dm[2].toString().padStart(2, "0");
      let yy = dm[3].toString();
      if (yy.length === 2) yy = (2000 + parseInt(yy, 10)).toString();
      found.push({ idx, d: `${dd}/${mm}/${yy}` });
    }
  }
  if (found.length) {
    const hasLE = (i: number) => upper.slice(Math.max(0, i - 6), i + 2).includes(" LE");
    const hasHour = (i: number) => /\sA\s\d{1,2}[:H]\d{2}/i.test(upper.slice(i, i + 20));
    found.sort((a, b) => {
      const sa = (hasLE(a.idx) ? 2 : 0) + (hasHour(a.idx) ? 1 : 0);
      const sb = (hasLE(b.idx) ? 2 : 0) + (hasHour(b.idx) ? 1 : 0);
      return sb - sa || a.idx - b.idx;
    });
    date = found[0].d;
  }

  // --- n° d’autorisation ---
  let auth: string | null = null;
  const auth1 =
    upperDigits.match(/(?:\bNO?\s*AUTO\b|\bAUTH(?:ORISATION|ORIZATION)?\b|AUTORISATION)\s*[:\-]?\s*([A-Z0-9]{6,})/) ||
    upperDigits.match(/\bNO\s*AUTO[:\-]?\s*([A-Z0-9]{6,})/);
  if (auth1) auth = auth1[1];

  // --- Score (1..5) ---
  let conf = 0;
  if (isCard) conf += 2;
  if (isConnect) conf += 2;
  if (provider !== "—") conf += 1;
  if (amount !== null) conf += 1;
  if (date) conf += 1;
  conf = Math.min(5, Math.max(1, conf));

  return {
    provider,
    type: isCard ? "CARTE" : isConnect ? "CONNECT" : "INCONNU",
    amount,
    date,
    confidence: conf,
    auth,
  };
}
