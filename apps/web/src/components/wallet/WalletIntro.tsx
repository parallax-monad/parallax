import { useEffect, useRef } from "react";
import introVideo from "@/assets/intro.mp4";

interface WalletIntroProps {
  onComplete: () => void;
}

export function WalletIntro({ onComplete }: WalletIntroProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const playVideo = async () => {
      try {
        await video.play();
      } catch (error) {
        console.error("Video autoplay failed:", error);
        onComplete();
      }
    };

    playVideo();

    const handleEnded = () => {
      onComplete();
    };

    video.addEventListener("ended", handleEnded);

    return () => {
      video.removeEventListener("ended", handleEnded);
    };
  }, [onComplete]);

  return (
    <div className="wallet-app-frame relative z-10 flex h-[calc(100vh-2.5rem)] flex-col items-center justify-center overflow-hidden rounded-[24px] border-none bg-[#0e1114] shadow-[0_8px_32px_rgba(0,0,0,0.12),_0_1px_3px_rgba(0,0,0,0.08)]">
      <video
        ref={videoRef}
        className="max-h-full max-w-full rounded-[24px]"
        muted
        playsInline
      >
        <source src={introVideo} type="video/mp4" />
      </video>
    </div>
  );
}
