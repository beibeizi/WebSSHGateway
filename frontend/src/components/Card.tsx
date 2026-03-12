import React from "react";

export type CardProps = {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  titleClassName?: string;
  descClassName?: string;
};

export function Card({ title, description, children, className, titleClassName, descClassName }: CardProps) {
  return (
    <div className={`rounded-xl border border-slate-700 bg-slate-900/70 p-6 shadow-lg ${className ?? ""}`}>
      <h2 className={`text-lg font-semibold text-slate-100 ${titleClassName ?? ""}`}>{title}</h2>
      {description ? <p className={`mt-1 text-sm text-slate-400 ${descClassName ?? ""}`}>{description}</p> : null}
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}
