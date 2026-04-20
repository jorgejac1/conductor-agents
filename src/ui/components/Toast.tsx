interface ToastProps {
	text: string;
	kind: "success" | "error";
}

export function Toast({ text, kind }: ToastProps) {
	return <div className={`toast ${kind}`}>{text}</div>;
}
