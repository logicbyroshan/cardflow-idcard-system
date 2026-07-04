import { useCallback, useEffect, useState } from 'react';

export default function useRefreshableResource(fetcher, { initialData = null, autoLoad = true } = {}) {
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(autoLoad);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const nextData = await fetcher();
      setData(nextData);
      return { success: true, data: nextData };
    } catch (err) {
      const message = err?.message || 'Failed to load data';
      setError(message);
      return { success: false, error: err, message };
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetcher]);

  useEffect(() => {
    if (autoLoad) {
      load(false);
    }
  }, [autoLoad, load]);

  return {
    data,
    setData,
    loading,
    refreshing,
    error,
    setError,
    load,
    refresh: () => load(true),
  };
}
