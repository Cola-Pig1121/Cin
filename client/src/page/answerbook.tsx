import { useCallback, useEffect, useRef, useState } from "react";
import { Seo } from "../components/seo";
import { useTranslation } from "react-i18next";
import { client } from "../app/runtime";
import { ImageWithFallback } from "../components/image-with-fallback";
import { apiErrorText } from "../utils/api-error";

/**
 * 百宝箱：一言 + 答案之书 + 随机图片，均经服务端 /api/uapis 代理。
 * 随机图片用 <img src> 直连同源代理，每次刷新换一张。
 */
export function AnswerBookPage() {
    const { t } = useTranslation();
    const [saying, setSaying] = useState("");
    const [question, setQuestion] = useState("");
    const [answer, setAnswer] = useState("");
    const [asking, setAsking] = useState(false);
    const [imgKey, setImgKey] = useState(() => Date.now());
    const reqId = useRef(0);

    const loadSaying = useCallback(async () => {
        const { data } = await client.uapis.saying();
        if (data?.text) setSaying(data.text);
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
        if (reqId.current !== id) return; // 丢弃过期响应
        setAnswer(data?.answer ?? apiErrorText(error));
        setAsking(false);
    }

    return (
        <div className="flex w-full flex-col gap-6">
            <Seo title={`${t("answerbook.title")} · Rin`} description={t("answerbook.book_desc")} path="/answerbook" />

            {/* 一言 */}
            <section className="rounded-2xl border border-black/10 bg-w p-5 dark:border-white/10">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-semibold t-primary">{t("answerbook.saying")}</h1>
                    <button type="button" onClick={() => void loadSaying()} className="text-sm text-theme hover:underline">
                        {t("answerbook.refresh")}
                    </button>
                </div>
                <p className="mt-3 text-neutral-600 dark:text-neutral-300">{saying || t("answerbook.loading")}</p>
            </section>

            {/* 答案之书 */}
            <section className="rounded-2xl border border-black/10 bg-w p-5 dark:border-white/10">
                <h2 className="text-lg font-semibold t-primary">{t("answerbook.book")}</h2>
                <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">{t("answerbook.book_desc")}</p>
                <div className="mt-3 flex gap-2">
                    <input
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void ask()}
                        placeholder={t("answerbook.ask_placeholder")}
                        maxLength={200}
                        className="min-w-0 flex-1 rounded-lg border border-black/10 bg-w px-3 py-2 text-sm t-primary outline-none placeholder:text-neutral-400 focus:border-black/20 dark:border-white/10"
                    />
                    <button
                        type="button"
                        onClick={() => void ask()}
                        disabled={asking || !question.trim()}
                        className="rounded-full bg-theme px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                    >
                        {asking ? t("answerbook.thinking") : t("answerbook.ask")}
                    </button>
                </div>
                {answer && (
                    <p className="mt-4 rounded-xl bg-secondary/60 p-4 text-lg font-medium t-primary">{answer}</p>
                )}
            </section>

            {/* 随机图片 */}
            <section className="rounded-2xl border border-black/10 bg-w p-5 dark:border-white/10">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-semibold t-primary">{t("answerbook.random_image")}</h2>
                    <button type="button" onClick={() => setImgKey(Date.now())} className="text-sm text-theme hover:underline">
                        {t("answerbook.refresh")}
                    </button>
                </div>
                <ImageWithFallback
                    key={imgKey}
                    src={client.uapis.randomImageUrl(undefined, imgKey)}
                    alt={t("answerbook.random_image")}
                    className="mt-3 aspect-video w-full rounded-xl"
                />
            </section>
        </div>
    );
}
