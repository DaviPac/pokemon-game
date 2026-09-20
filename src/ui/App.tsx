import { useState } from 'react';
import { OverworldScreen } from './overworld/OverworldScreen.js';
import { SettingsSheet } from './screens/SettingsSheet.js';
import { Dialogue } from './shell/Dialogue.js';

export function App() {
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="app">
      <OverworldScreen
        startMap="MAP_PALLET_TOWN"
        startX={6}
        startY={8}
        onEncounter={(kind) => setDialogue(`Um Pokemon selvagem apareceu! (${kind})`)}
        onInteract={setDialogue}
        onMenu={() => setSettingsOpen(true)}
      />
      {dialogue && <Dialogue text={dialogue} onClose={() => setDialogue(null)} />}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
