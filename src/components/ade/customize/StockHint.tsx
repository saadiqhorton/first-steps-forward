export function StockHint() {
  return (
    <p className="text-xs leading-5 text-dim">
      To start ADE without your changes, run{" "}
      <code className="rounded-xs border border-line bg-paper px-1.5 py-0.5 font-mono text-xs text-ink">
        ade --stock
      </code>
    </p>
  );
}
