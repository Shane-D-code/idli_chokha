import { useEffect } from 'react'
import { Header } from './components/layout/Header'
import { Footer } from './components/layout/Footer'
import { AtmosphereBackground } from './components/layout/AtmosphereBackground'
import { HeroSection } from './components/hero/HeroSection'
import { StatementStrip } from './components/hero/StatementStrip'
import { GenesisSection } from './components/genesis/GenesisSection'
import { ForecastSection } from './components/forecast/ForecastSection'
import { HazardsSection } from './components/hazards/HazardsSection'
import { DistrictsSection } from './components/districts/DistrictsSection'
import { Environment } from './components/environment/Environment'
import { Explain } from './components/explain/Explain'
import { DataSection } from './components/data/DataSection'
import { appActions } from './state/store'

export default function App() {
  useEffect(() => {
    void appActions.init()
  }, [])

  return (
    <div className="relative min-h-screen">
      <AtmosphereBackground />
      <Header />
      <main className="relative z-10">
        <HeroSection />
        <StatementStrip />
        <GenesisSection />
        <ForecastSection />
        <HazardsSection />
        <DistrictsSection />
        <Environment />
        <Explain />
        <DataSection />
      </main>
      <Footer />
    </div>
  )
}