import { useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../app/runtime";
import { ImageWithFallback } from "./image-with-fallback";

/**
 * 文章详情页分享条：位于正文之后、评论区之前。
 * 点「分享」展开面板：一键复制链接 + 当前文章 URL 的二维码（经服务端代理）。
 */
export function PostShare() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const url = typeof window !== "undefined" ? window.location.href : "";

    async function copy() {
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        } catch {
            setCopied(false);
        }
    }

    return (
        <div className="my-6 flex flex-col items-center gap-3">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-w px-5 py-2 text-sm font-medium t-primary transition-colors hover:bg-secondary dark:border-white/10"
            >
                <i className="ri-share-forward-line" />
                {t("share.title", "分享")}
            </button>
            {open && (
                <div className="ani-show flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl border border-black/10 bg-w p-5 dark:border-white/10">
                    <ImageWithFallback
                        src={client.uapis.qrcodeUrl(url, 240)}
                        alt={t("share.qr", "二维码")}
                        className="h-44 w-44 rounded-xl"
                    />
                    <button
                        type="button"
                        onClick={() => void copy()}
                        className="w-full rounded-full bg-theme px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                    >
                        {copied ? t("share.copied", "已复制") : t("share.copy_link", "复制链接")}
                    </button>
                    <p className="w-full truncate text-center text-[11px] text-neutral-400">{url}</p>
                </div>
            )}
        </div>
    );
}
