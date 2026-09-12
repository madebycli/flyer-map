import type { ReactNode } from "react";
import { FieldBottomSheet, type FieldSheetSnap } from "./FieldBottomSheet.tsx";
import "./field-hub.css";

type FieldHubProps = {
  open?: boolean;
  title: string;
  kicker?: string;
  headerAside?: ReactNode;
  onClose: () => void;
  onTitleClick?: () => void;
  overlayClassName?: string;
  initialSnap?: FieldSheetSnap;
  retractable?: boolean;
  initialRetracted?: boolean;
  className?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function FieldHub({
  open = true,
  title,
  kicker,
  headerAside,
  onClose,
  onTitleClick,
  overlayClassName = "",
  initialSnap = "expanded",
  retractable = false,
  initialRetracted = false,
  className = "",
  children,
  footer,
}: FieldHubProps) {
  return (
    <FieldBottomSheet
      open={open}
      title={title}
      kicker={kicker}
      headerAside={headerAside}
      onClose={onClose}
      onTitleClick={onTitleClick}
      overlayClassName={overlayClassName}
      initialSnap={initialSnap}
      retractable={retractable}
      initialRetracted={initialRetracted}
      className={`field-hub ${className}`.trim()}
      footer={footer}
    >
      {children}
    </FieldBottomSheet>
  );
}

export function FieldHubStack({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`field-hub-stack ${className}`.trim()}>{children}</div>;
}

export function FieldHubCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`field-hub-card ${className}`.trim()}>{children}</section>;
}

export function FieldHubHeading({
  eyebrow,
  title,
  aside,
}: {
  eyebrow: string;
  title: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="field-hub-heading">
      <div>
        <span>{eyebrow}</span>
        <strong>{title}</strong>
      </div>
      {aside ? <div className="field-hub-heading-aside">{aside}</div> : null}
    </div>
  );
}

export function FieldHubEmpty({ children }: { children: ReactNode }) {
  return <div className="field-hub-empty">{children}</div>;
}
