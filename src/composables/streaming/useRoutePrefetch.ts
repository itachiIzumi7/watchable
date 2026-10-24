import { useRouter, type RouteLocationRaw, type Router } from 'vue-router';

/**
 * Prefetches the code-split component chunk for a target route location.
 */
export function prefetchResolvedRoute(router: Router, target: RouteLocationRaw | undefined | null): void {
    if (!target) return;
    try {
        const resolved = router.resolve(target);
        if (resolved?.matched?.length) {
            resolved.matched.forEach((record) => {
                const comp = record.components?.default;
                if (typeof comp === 'function') {
                    (comp as any)();
                }
            });
        }
    } catch {
        // Silently ignore prefetch errors
    }
}

export function useRoutePrefetch() {
    const router = useRouter();
    const prefetchRoute = (target: RouteLocationRaw | undefined | null) => {
        prefetchResolvedRoute(router, target);
    };
    return { prefetchRoute };
}
