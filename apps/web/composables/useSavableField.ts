interface UseSavableFieldReturn {
  loading: Ref<boolean>;
  error: Ref<string | null>;
  submit: (value: unknown) => Promise<void>;
}

/**
 * Generic replacement for the repeated `loading/error` + `try/catch/finally`
 * pattern used by editable-field save handlers (settings page: pseudo,
 * battletag, publicHandle).
 */
export function useSavableField(save: (value: unknown) => Promise<void>): UseSavableFieldReturn {
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function submit(value: unknown) {
    loading.value = true;
    error.value = null;
    try {
      await save(value);
    } catch (err) {
      error.value = (err as { data?: { error?: string } })?.data?.error ?? "Erreur lors de la mise à jour";
    } finally {
      loading.value = false;
    }
  }

  return { loading, error, submit };
}
