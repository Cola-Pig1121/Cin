import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { client } from "../app/runtime";
import { ImageWithFallback } from "./image-with-fallback";
import { apiErrorText } from "../utils/api-error";

/**
 * 首页顶部「百宝箱」hero：随机图片 → 一言 → 答案之书，纵向堆叠。
 * 数据经服务端 /api/uapis 代理；图片用 <img> 直连同源代理。风格贴合站点
 * （bg-w / rounded-2xl / text-theme / 暗色变体）。
 */
export function HomeHero() {
    const { t } = useTranslation();
    const [saying, setSaying] = useState("");
    const [sayingLoading, setSayingLoading] = useState(true);
    const [imgKey, setImgKey] = useState(() => Date.now());
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [asking, setAsking] = useState(false);
    const reqId = useRef(0);

    const loadSaying = useCallback(async () => {
        setSayingLoading(true);
        const { data } = await client.uapis.saying();
        if (data?.text) setSaying(data.text);
        setSayingLoading(false);
    }, []);

    useEffect(() => {
        void loadSaying();
    }, [loadSaying]);

    async function ask() {
        const q = question.trim();
        if (!q || asking) return;
        const id = ++reqId.current;
        setAsking(true);
        setAnswer("");
        const { data, error } = await client.uapis.answerbook(q);
        if (reqId.current !== id) return;
        setAnswer(data?.answer ?? apiErrorText(error));
        setAsking(false);
    }

    return (
        <div className="wauto mb-6 flex flex-col gap-4">
            {/* 随机图片横幅 */}
            <div className="group relative overflow-hidden rounded-2xl border border-black/10 dark:border-white/10">
                <ImageWithFallback
                    key={imgKey}
                    src={client.uapis.randomImageUrl(undefined, imgKey)}
                    alt={t("answerbook.random_image")}
                    className="h-44 w-full sm:h-56"
                />
                <button
                    type="button"
                    onClick={() => setImgKey(Date.now())}
                    title={t("answerbook.refresh")}
                    className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center rounded-full bg-black/40 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/60 group-hover:opacity-100"
                >
                    <i className="ri-refresh-line" />
                </button>
            </div>

            {/* 一言 */}
            <div className="rounded-2xl border border-black/10 bg-w p-5 dark:border-white/10">
                <div className="flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">{t("answerbook.saying")}</span>
                    <button type="button" onClick={() => void loadSaying()} className="text-xs text-theme hover:underline">
                        {t("answerbook.refresh")}
                    </button>
                </div>
                <p className="mt-2 min-h-6 text-center text-lg italic t-primary">
                    {sayingLoading && !saying ? t("answerbook.loading") : `「${saying}」`}
                </p>
            </div>

            {/* 答案之书 */}
            <div className="rounded-2xl border border-black/10 bg-w p-5 dark:border-white/10">
                <div className="flex items-center justify-between">
                    <span className="text-base font-semibold t-primary">{t("answerbook.book")}</span>
                    <span className="text-xs text-neutral-400">{t("answerbook.book_desc")}</span>
                </div>
                <div className="mt-3 flex gap-2">
                    <input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void ask()}
                        placeholder={t("answerbook.ask_placeholder")}
                        maxLength={200}
                        className="min-w-0 flex-1 rounded-full border border-black/10 bg-w px-4 py-2 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-theme dark:border-white/10"
                    />
                    <button
                        type="button"
                        onClick={() => void ask()}
                        disabled={asking || !question.trim()}
                        className="shrink-0 rounded-full bg-theme px-5 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                        {asking ? t("answerbook.thinking") : t("answerbook.ask")}
                    </button>
                </div>
                {answer && (
                    <p className="mt-4 rounded-xl bg-secondary/60 px-4 py-3 text-center text-base font-medium t-primary ani-show">
                        {answer}
                    </p>
                )}
            </div>
        </div>
    );
}
