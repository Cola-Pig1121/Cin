import { useEffect, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile 组件。
 *
 * 设计要点：
 * - **脚本按需加载**：只在真正需要验证时才注入，避免拖累首屏。
 * - **显式渲染**：用 `render=explicit` + 手动 `turnstile.render()`，
 *   避免 Turnstile 自动在首个 .cf-turnstile 容器里注入造成重复渲染。
 * - **幂等渲染**：React StrictMode 下 effect 会「挂载→清理→再挂载」跑两遍，
 *   必须保证最终状态是「widget 存在」而不是「被去重逻辑挡住」。
 *   实现方式是检查 DOM 里是否已有 iframe，而不是用一个可能与实际脱节的 widgetId。
 * - **失败可见**：脚本加载失败时给出明确提示，而不是让用户对着空白页猜。
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement | string,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          action?: string;
          theme?: 'auto' | 'light' | 'dark';
          /**
           * 合法值只有 'always' | 'execute' | 'interaction-only'。
           * 注意 `'explicit'` 不是 appearance 的合法值 —— 它是
           * 脚本 URL 上的 `?render=explicit` 参数，两者别混。
           * 传错会让 Turnstile 抛 TurnstileError，widget 永远渲染不出来。
           */
          appearance?: 'always' | 'execute' | 'interaction-only';
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_BASE = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
const SCRIPT_SRC = `${SCRIPT_BASE}?render=explicit`;

let scriptPromise: Promise<void> | null = null;

/**
 * 加载 Turnstile 脚本。全局只注入一次。
 * 失败时清空缓存，让后续重试能重新注入。
 */
function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) {
    return Promise.resolve();
  }

  if (scriptPromise) {
    return scriptPromise;
  }

  const promise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="${SCRIPT_BASE}"]`);

    // 已有脚本但可能仍在加载中，挂回调等待其完成。
    if (existing) {
      if (window.turnstile) {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Turnstile script')),
        { once: true },
      );
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener(
      'error',
      () => reject(new Error('Failed to load Turnstile script')),
      { once: true },
    );
    document.head.appendChild(script);
  });

  // 失败时清空缓存，否则后续所有重试都会立刻拿到同一个 rejected promise
  promise.catch(() => {
    if (scriptPromise === promise) {
      scriptPromise = null;
    }
  });

  scriptPromise = promise;
  return promise;
}

export type TurnstileWidgetProps = {
  siteKey: string;
  /** 验证通过回调，参数是可用于服务端校验的 token */
  onToken: (token: string) => void;
  /** token 过期（Turnstile token 有 TTL） */
  onExpire?: () => void;
  /** widget 内部报错或脚本加载失败 */
  onError?: () => void;
  /** 传给 Cloudflare 的 action 名，便于后台按用途统计 */
  action?: string;
  theme?: 'auto' | 'light' | 'dark';
  className?: string;
};

export function TurnstileWidget({
  siteKey,
  onToken,
  onExpire,
  onError,
  action,
  theme = 'auto',
  className,
}: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 仅在「确实需要重置」时使用，不参与渲染去重判断
  const widgetIdRef = useRef<string | null>(null);
  // 当前 DOM 里已渲染的 widget 对应的 siteKey，用于判断是否需要重建
  const renderedKeyRef = useRef<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  /** 移除当前 widget 并清空状态。重复调用安全。 */
  function clearWidget() {
    if (widgetIdRef.current !== null && window.turnstile) {
      try {
        window.turnstile.remove(widgetIdRef.current);
      } catch {
        // widget 可能已被浏览器回收
      }
      widgetIdRef.current = null;
    }

    // 兜底清空 DOM：没有句柄时（脚本尚未就绪、或 remove 失败）
    // 残留的 iframe 会让下一次渲染的幂等判断误判
    containerRef.current?.replaceChildren();
    renderedKeyRef.current = null;
  }

  // cleanup 回调里直接用 ref 指向的实现，避免闭包捕获到过期的 ref
  const clearWidgetRef = useRef(clearWidget);
  clearWidgetRef.current = clearWidget;

  // 用 ref 保存回调，避免父组件重渲染导致依赖变化而重建 widget
  const onTokenRef = useRef(onToken);
  const onExpireRef = useRef(onExpire);
  const onErrorRef = useRef(onError);
  onTokenRef.current = onToken;
  onExpireRef.current = onExpire;
  onErrorRef.current = onError;

  // 注册是「必须完成验证」的场景，必须用 'always' 让 widget 显式可见。
  //
  // 不要用 'interaction-only'：那个模式下 widget 只是页面角落一个几乎看不见的小徽章，
  // 平时完全不显眼，用户会以为「没有验证码」，实际却是必须的。
  // 第三方封装库（如 @marsidev/react-turnstile）的示例常用 interaction-only
  // 或 execute，那是给「静默打分」场景用的，不适合强制验证。
  const appearance = 'always';

  useEffect(() => {
    if (!siteKey) {
      onErrorRef.current?.();
      return;
    }

    let disposed = false;

    const renderWidget = () => {
      if (disposed) return;

      const container = containerRef.current;
      if (!container || !window.turnstile) return;

      // 幂等判断以「这个 siteKey 是否已渲染」为准。
      //
      // 不能只看 widgetIdRef：它只是一个句柄，在 StrictMode 的
      // 「挂载→清理→再挂载」过程中可能被清空而 iframe 仍在，
      // 用句柄去重会让第二次挂载被误判为「已渲染」而永不重建。
      // 也不能只看「有没有 iframe」：siteKey 变更时旧 iframe 仍在，
      // 会导致新 key 拿不到 widget。
      if (renderedKeyRef.current === siteKey && container.querySelector('iframe')) {
        return;
      }

      // siteKey 变了（或残留了别的 widget），先清干净再渲染
      if (renderedKeyRef.current !== siteKey) {
        clearWidget();
      }

      try {
        widgetIdRef.current = window.turnstile.render(container, {
          sitekey: siteKey,
          action,
          theme,
          appearance,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onExpireRef.current?.(),
          'error-callback': () => onErrorRef.current?.(),
        });
        renderedKeyRef.current = siteKey;
      } catch (error) {
        console.error('[turnstile] render failed', error);
        onErrorRef.current?.();
      }
    };

    loadTurnstileScript()
      .then(renderWidget)
      .catch((error) => {
        if (disposed) return;
        console.error('[turnstile] script load failed', error);
        setLoadFailed(true);
        onErrorRef.current?.();
      });

    return () => {
      disposed = true;
      // 注意：这里刻意不 remove widget。
      // StrictMode 的 cleanup 会在同一次挂载中立刻重跑，
      // 此时 remove 会先执行、随后 renderWidget 又因 iframe 还在而跳过，
      // 净效果是 iframe 被移除且不再重建 → widget 永久消失。
      // 真正的卸载清理由下面的 useEffect 负责。
    };
  }, [siteKey, action, theme]);

  // 真正的卸载清理：此时不会再重挂载，可以放心移除
  useEffect(() => {
    // clearWidget 依赖 containerRef 的当前值，用 ref 兜住避免闭包读到旧值
    return () => clearWidgetRef.current();
  }, []);

  // 组件卸载后 ref 会变成 null，这里提前把重置方法挂到节点上供调用方使用
  const attachRef = (node: HTMLDivElement | null) => {
    containerRef.current = node;
    if (node) {
      (node as HTMLDivElement & { __turnstileReset?: () => void }).__turnstileReset = () => {
        if (widgetIdRef.current !== null && window.turnstile) {
          window.turnstile.reset(widgetIdRef.current);
        }
      };
    }
  };

  if (loadFailed) {
    return (
      <div className={className}>
        <p className="text-sm text-red-500">
          人机验证组件加载失败，请检查网络后刷新页面重试。
        </p>
      </div>
    );
  }

  return <div ref={attachRef} className={className} data-sitekey={siteKey} />;
}

/**
 * 命令式重置：验证码校验失败后必须调用，否则用户无法重试。
 */
export function resetTurnstile(element: HTMLElement | null | undefined) {
  if (!element) return;
  const withReset = element as HTMLDivElement & { __turnstileReset?: () => void };
  withReset.__turnstileReset?.();
}
