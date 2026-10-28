import { IBM_Plex_Mono } from "next/font/google";
import PokerGame from "@/components/PokerGame";

// cyrillic for the croupier's ж
const plex = IBM_Plex_Mono({ weight: ["400", "600"], subsets: ["latin", "cyrillic"] });

export default function Home() {
  return (
    <main className={plex.className}>
      <PokerGame fontFamily={plex.style.fontFamily} />
    </main>
  );
}
