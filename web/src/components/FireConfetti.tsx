import { useEffect, useRef } from "react";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  color: string;
  size: number;
  rotation: number;
  rotationSpeed: number;
  type: "sparkle" | "confetti" | "flame";
}

export const FireConfetti = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId: number;
    let particles: Particle[] = [];

    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    // Warm, fiery colors mixed with success greens for an exciting look
    const colors = [
      "#FF3F00", // Bright Red-Orange
      "#FF7F00", // Vibrant Orange
      "#FFD700", // Gold
      "#FFA500", // Yellow-Orange
      "#FF4B4B", // Fiery Pinkish-Red
      "#10B981", // Success Green
      "#34D399", // Mint Green
    ];

    const createParticle = (x: number, y: number, isInitial = false): Particle => {
      const angle = Math.random() * Math.PI * 2;
      // Initial burst particles have higher velocity; continuous sparkles are slower
      const speed = isInitial ? Math.random() * 10 + 5 : Math.random() * 4 + 2;
      
      const particleTypes: Array<"sparkle" | "confetti" | "flame"> = [
        "sparkle",
        "confetti",
        "flame",
      ];
      const type = particleTypes[Math.floor(Math.random() * particleTypes.length)];

      return {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (isInitial ? Math.random() * 5 + 3 : Math.random() * 2), // upward bias
        alpha: 1,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 8 + 4,
        rotation: Math.random() * 360,
        rotationSpeed: Math.random() * 8 - 4,
        type,
      };
    };

    // Spawn initial dramatic bursts
    const spawnBurst = (x: number, y: number, count: number, isInitial = false) => {
      for (let i = 0; i < count; i++) {
        particles.push(createParticle(x, y, isInitial));
      }
    };

    const width = window.innerWidth;
    const height = window.innerHeight;

    // Launch bursts from center, bottom-left, and bottom-right
    spawnBurst(width / 2, height / 2, 90, true);
    setTimeout(() => spawnBurst(width * 0.2, height * 0.7, 70, true), 300);
    setTimeout(() => spawnBurst(width * 0.8, height * 0.7, 70, true), 600);

    // Continuous sparkly flame-like ambient bursts for 3 seconds
    const interval = setInterval(() => {
      spawnBurst(
        width / 2 + (Math.random() * 160 - 80),
        height / 2 - 40 + (Math.random() * 100 - 50),
        8,
        false
      );
    }, 120);

    // Stop continuous spawning after 3 seconds
    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, 3200);

    const updateAndDraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Keep active particles
      particles = particles.filter((p) => p.alpha > 0.01);

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        // Apply physics
        p.vy += 0.18; // gravity
        p.vx *= 0.97; // drag
        p.vy *= 0.97;
        p.alpha -= p.type === "flame" ? 0.02 : 0.012; // flame particles fade faster
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.fillStyle = p.color;

        if (p.type === "flame") {
          // Draw a teardrop-shaped flame particle
          ctx.beginPath();
          ctx.moveTo(0, -p.size);
          ctx.quadraticCurveTo(p.size / 2, 0, 0, p.size);
          ctx.quadraticCurveTo(-p.size / 2, 0, 0, -p.size);
          ctx.fill();
        } else if (p.type === "sparkle") {
          // Draw a 4-point star sparkle
          ctx.beginPath();
          for (let i = 0; i < 4; i++) {
            ctx.lineTo(0, -p.size);
            ctx.lineTo(p.size * 0.2, -p.size * 0.2);
            ctx.rotate(Math.PI / 2);
          }
          ctx.fill();
        } else {
          // Draw standard rectangular confetti
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        }

        ctx.restore();
      });

      animationFrameId = requestAnimationFrame(updateAndDraw);
    };

    updateAndDraw();

    return () => {
      window.removeEventListener("resize", resizeCanvas);
      cancelAnimationFrame(animationFrameId);
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-50 w-full h-full"
      style={{ mixBlendMode: "screen" }}
    />
  );
};
