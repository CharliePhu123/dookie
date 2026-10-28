import { IBM_Plex_Mono } from "next/font/google";
import MockTable from "@/components/MockTable";

const plex = IBM_Plex_Mono({ weight: ["400", "600"], subsets: ["latin"] });

export default function Home() {
  return (
    <main className={plex.className}>
      <MockTable fontFamily={plex.style.fontFamily} />
    </main>
  );
}
