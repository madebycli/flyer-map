import { useState } from "react";
import {
  validateSupportFeedbackDraft,
  type SupportFeedbackCategory,
  type SupportFeedbackDraft,
} from "./supportFeedback.ts";
import "./support-panel.css";

export type SupportPanelLabels = {
  title: string;
  helpTitle: string;
  helpBody: string;
  diagnosticsTitle: string;
  copyDiagnostics: string;
  copiedDiagnostics: string;
  feedbackTitle: string;
  category: string;
  bug: string;
  idea: string;
  question: string;
  feedbackSubject: string;
  feedbackMessage: string;
  includeCampaignContext: string;
  submit: string;
  invalidFeedback: string;
};

type Props = {
  labels: SupportPanelLabels;
  diagnosticsText: string;
  onSubmit: (feedback: SupportFeedbackDraft) => void | Promise<void>;
};

export function SupportPanel({ labels, diagnosticsText, onSubmit }: Props) {
  const [category, setCategory] = useState<SupportFeedbackCategory>("bug");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [includeCampaignContext, setIncludeCampaignContext] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(diagnosticsText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const submit = async () => {
    const validation = validateSupportFeedbackDraft({
      category,
      title,
      message,
      includeCampaignContext,
    });
    if (!validation.valid) {
      setInvalid(true);
      return;
    }

    setInvalid(false);
    setBusy(true);
    try {
      await onSubmit(validation.value);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="support-panel" aria-labelledby="support-panel-title">
      <h2 id="support-panel-title">{labels.title}</h2>

      <section className="support-panel-card">
        <h3>{labels.helpTitle}</h3>
        <p>{labels.helpBody}</p>
      </section>

      <section className="support-panel-card">
        <h3>{labels.diagnosticsTitle}</h3>
        <pre className="support-diagnostics">{diagnosticsText}</pre>
        <button className="support-secondary-button" type="button" onClick={copyDiagnostics}>
          {copied ? labels.copiedDiagnostics : labels.copyDiagnostics}
        </button>
      </section>

      <section className="support-panel-card">
        <h3>{labels.feedbackTitle}</h3>
        <label className="support-field">
          <span>{labels.category}</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as SupportFeedbackCategory)}
          >
            <option value="bug">{labels.bug}</option>
            <option value="idea">{labels.idea}</option>
            <option value="question">{labels.question}</option>
          </select>
        </label>
        <label className="support-field">
          <span>{labels.feedbackSubject}</span>
          <input
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="support-field">
          <span>{labels.feedbackMessage}</span>
          <textarea
            value={message}
            maxLength={4_000}
            rows={7}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <label className="support-context-toggle">
          <input
            type="checkbox"
            checked={includeCampaignContext}
            onChange={(event) => setIncludeCampaignContext(event.target.checked)}
          />
          <span>{labels.includeCampaignContext}</span>
        </label>
        {invalid ? <p className="support-error" role="alert">{labels.invalidFeedback}</p> : null}
        <button
          className="support-primary-button"
          type="button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {labels.submit}
        </button>
      </section>
    </section>
  );
}
