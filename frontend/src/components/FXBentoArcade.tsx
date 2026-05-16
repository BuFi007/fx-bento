import * as React from "react";

type Room = {
  id: string;
  market: string;
  entryFee: string;
  players: number;
  maxPlayers: number;
  prizePool: string;
};

const sampleRooms: Room[] = [
  { id: "tokyo-1", market: "USDC/EURC", entryFee: "5 USDC", players: 8, maxPlayers: 20, prizePool: "36 USDC" },
  { id: "quito-2", market: "USDC/MXNB", entryFee: "5 USDC", players: 3, maxPlayers: 10, prizePool: "13.5 USDC" }
];

export function ArcadeLobby() {
  const [selectedRoom, setSelectedRoom] = React.useState<Room>(sampleRooms[0]);
  return (
    <main className="fxb-shell">
      <section className="fxb-lobby">
        <div>
          <p className="fxb-kicker">FX Bento Arcade</p>
          <h1>FX² Arcade Protocol</h1>
          <p>Join kawaii FX prediction rooms. Same chips. Same market. Highest score wins.</p>
        </div>
        <button className="fxb-primary">Play FX Bento</button>
      </section>
      <div className="fxb-layout">
        <FXBentoModeCard />
        <RoomList rooms={sampleRooms} onSelect={setSelectedRoom} />
        <RoomRulesCard />
        <WaitingRoom room={selectedRoom} />
        <PrizePoolCard room={selectedRoom} />
        <GameBoard />
        <LiveLeaderboard />
      </div>
    </main>
  );
}

export function FXBentoModeCard() {
  return (
    <section className="fxb-panel">
      <h2>FX Bento</h2>
      <p>Kawaii square-tile FX predictions with capped player-funded prize pools.</p>
      <button className="fxb-secondary">Create Room</button>
    </section>
  );
}

export function RoomList({ rooms, onSelect }: { rooms: Room[]; onSelect: (room: Room) => void }) {
  return (
    <section className="fxb-panel">
      <h2>Rooms</h2>
      {rooms.map((room) => (
        <button className="fxb-room-row" key={room.id} onClick={() => onSelect(room)}>
          <span>{room.market}</span>
          <span>{room.players}/{room.maxPlayers}</span>
          <strong>{room.prizePool}</strong>
        </button>
      ))}
    </section>
  );
}

export function CreateRoomModal() {
  return (
    <form className="fxb-panel">
      <h2>Create Room</h2>
      <label>Market<input defaultValue="USDC/EURC" /></label>
      <label>Entry<input defaultValue="5 USDC" /></label>
      <label>Players<input defaultValue="2-20" /></label>
      <button className="fxb-primary" type="button">Create</button>
    </form>
  );
}

export function RoomRulesCard() {
  const rules = ["Entry: 5 USDC", "Players: 2-20", "Rounds: 10", "Market: USDC/EURC", "Protocol fee: 10%", "Prize pool: player-funded", "Same chip budget for everyone", "Pick future tiles before they lock", "Spread chips for safety, concentrate for higher score", "No walls, no spam, no last-second sniping"];
  return <section className="fxb-panel"><h2>Rules</h2>{rules.map((rule) => <p key={rule}>{rule}</p>)}</section>;
}

export function WaitingRoom({ room }: { room: Room }) {
  return <section className="fxb-panel"><h2>Waiting Room</h2><PlayerList count={room.players} max={room.maxPlayers} /><CommitCountdown seconds={42} /></section>;
}

export function PlayerList({ count, max }: { count: number; max: number }) {
  return <div className="fxb-players">{Array.from({ length: max }, (_, i) => <span className={i < count ? "active" : ""} key={i} />)}</div>;
}

export function PrizePoolCard({ room }: { room: Room }) {
  return <section className="fxb-panel"><h2>Prize Pool</h2><strong className="fxb-prize">{room.prizePool}</strong><p>Winners are paid only from room escrow.</p></section>;
}

export function GameBoard() {
  const [selected, setSelected] = React.useState(new Set<string>());
  const toggle = (key: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  return (
    <section className="fxb-board-wrap">
      <ChipBudgetBar used={selected.size} total={5} />
      <LockZoneOverlay />
      <BentoTileGrid selected={selected} onToggle={toggle} />
    </section>
  );
}

export function BentoTileGrid({ selected, onToggle }: { selected: Set<string>; onToggle: (key: string) => void }) {
  return <div className="fxb-grid">{Array.from({ length: 40 }, (_, i) => <button key={i} className={selected.has(String(i)) ? "selected" : ""} onClick={() => onToggle(String(i))} />)}</div>;
}

export function ChipBudgetBar({ used, total }: { used: number; total: number }) {
  return <div className="fxb-chipbar"><span>Chips</span><progress value={total - used} max={total} /></div>;
}

export function CommitCountdown({ seconds }: { seconds: number }) {
  return <div className="fxb-countdown">{seconds}s</div>;
}

export function LockZoneOverlay() {
  return <div className="fxb-lock">Lock zone</div>;
}

export function LiveLeaderboard() {
  return <section className="fxb-panel"><h2>Leaderboard</h2><ol><li>Alice 1200</li><li>Bob 980</li></ol></section>;
}

export function RoundResultModal() {
  return <section className="fxb-panel"><h2>Round Result</h2><p>Hit tile settled. Score updated.</p></section>;
}

export function FinalLeaderboard() {
  return <section className="fxb-panel"><h2>Final Leaderboard</h2><ClaimPrizeButton /></section>;
}

export function ClaimPrizeButton() {
  return <button className="fxb-primary">Claim Prize</button>;
}
