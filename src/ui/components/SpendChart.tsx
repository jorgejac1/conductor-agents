import { useEffect, useRef } from "react";

interface Bar {
	label: string;
	value: number;
	color: string;
}

interface SpendChartProps {
	bars: Bar[];
	maxValue: number;
}

export function SpendChart({ bars, maxValue }: SpendChartProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Scale for device pixel ratio
		const dpr = window.devicePixelRatio || 1;
		const rect = canvas.getBoundingClientRect();
		canvas.width = rect.width * dpr;
		canvas.height = rect.height * dpr;
		ctx.scale(dpr, dpr);

		const W = rect.width;
		const H = rect.height;
		const paddingBottom = 18;
		const chartH = H - paddingBottom;

		ctx.clearRect(0, 0, W, H);

		if (bars.length === 0 || maxValue === 0) {
			ctx.fillStyle = "#64748b";
			ctx.font = "11px monospace";
			ctx.textAlign = "center";
			ctx.fillText("No spend data yet", W / 2, H / 2);
			return;
		}

		const barWidth = Math.floor((W - (bars.length - 1) * 4) / bars.length);
		const gap = 4;

		bars.forEach((bar, i) => {
			const x = i * (barWidth + gap);
			const barH = maxValue > 0 ? Math.round((bar.value / maxValue) * chartH) : 0;
			const y = chartH - barH;

			// Bar
			ctx.fillStyle = bar.color;
			ctx.globalAlpha = 0.8;
			ctx.beginPath();
			ctx.roundRect(x, y, barWidth, barH, [2, 2, 0, 0]);
			ctx.fill();
			ctx.globalAlpha = 1;

			// Label — truncate to fit bar width (~7 chars at 9px monospace per bar)
			ctx.fillStyle = "#64748b";
			ctx.font = "9px monospace";
			ctx.textAlign = "center";
			const maxChars = Math.max(3, Math.floor(barWidth / 6));
			const label =
				bar.label.length > maxChars ? `${bar.label.slice(0, maxChars - 1)}…` : bar.label;
			ctx.fillText(label, x + barWidth / 2, H - 4);
		});
	}, [bars, maxValue]);

	return (
		<canvas
			ref={canvasRef}
			className="spend-canvas"
			style={{ width: "100%", height: "100%", display: "block" }}
		/>
	);
}
