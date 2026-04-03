import { ref } from 'vue'

interface MentorStage {
  key: string
  label: string
  total: number
  delta_count: number
  last_updated_at: string | null
}

interface MentorDelta {
  key: string
  label: string
  delta_count: number
  total: number
}

interface MentorProgressPayload {
  progress_overview: {
    stages: MentorStage[]
  }
  progress_deltas: {
    dashboard: MentorDelta[]
  }
}

const defaultPayload: MentorProgressPayload = {
  progress_overview: {
    stages: [
      {
        key: 'verified_records',
        label: 'Verified Records',
        total: 0,
        delta_count: 0,
        last_updated_at: null,
      },
      {
        key: 'training_ready_outputs',
        label: 'Training Ready Outputs',
        total: 0,
        delta_count: 0,
        last_updated_at: null,
      },
    ],
  },
  progress_deltas: {
    dashboard: [],
  },
}

export function useMentorProgress(immediate = true) {
  const progress = ref<MentorProgressPayload | null>(immediate ? defaultPayload : null)
  const loading = ref(false)
  const error = ref('')

  async function refresh() {
    loading.value = false
    error.value = ''
    progress.value = defaultPayload
    return defaultPayload
  }

  return {
    progress,
    loading,
    error,
    refresh,
  }
}
