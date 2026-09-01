import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import "./share-link-modal.css";

type ShareLinkModalProps = {
  title: string;
  description: string;
  url: string;
  onClose: () => void;
};

export function ShareLinkModal({ title, description, url, onClose }: ShareLinkModalProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="share-link-overlay" role="presentation" onMouseDown={onClose}>
      <section
        className="share-link-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-link-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span>Link teilen</span>
            <strong id="share-link-title">{title}</strong>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen">×</button>
        </header>
        <p>{description}</p>
        <input readOnly value={url} aria-label={`${title} URL`} />
        <button className="button secondary full-width" type="button" onClick={() => void copy()}>
          {copied ? "Kopiert" : "Link kopieren"}
        </button>
        <div className="share-link-qr">
          <QRCodeSVG value={url} size={208} level="M" title={`QR-Code: ${title}`} includeMargin />
        </div>
      </section>
    </div>
  );
}
