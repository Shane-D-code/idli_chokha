/** Fixed, animated weather backdrop — warm cream canvas with drifting sky tints. */
export function AtmosphereBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 paper-grain" />
      <div className="absolute inset-0 bg-[radial-gradient(1000px_560px_at_8%_-8%,#eef4f8_0%,transparent_60%),radial-gradient(1100px_620px_at_106%_2%,#f2ead9_0%,transparent_55%),radial-gradient(1200px_700px_at_55%_110%,#eef4f8_0%,transparent_55%)]" />

      {/* drifting warm cloud bands */}
      <div className="animate-drift absolute -top-6 left-[-15%] h-40 w-[70%] rounded-full bg-cloud/80 blur-3xl" />
      <div className="animate-drift-slow absolute top-1/4 left-[-20%] h-56 w-[80%] rounded-full bg-brand-100/50 blur-3xl" />
      <div className="animate-drift absolute top-2/3 left-[-10%] h-48 w-[65%] rounded-full bg-parcel/70 blur-3xl" />

      <div className="absolute -right-24 top-10 h-72 w-72 rounded-full bg-brand-200/30 blur-3xl" />
      <div className="absolute -left-20 bottom-10 h-80 w-80 rounded-full bg-warn-100/50 blur-3xl" />
    </div>
  )
}