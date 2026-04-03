<script setup lang="ts" generic="T">
import { computed, ref, watch, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

type SkeletonItem = {
  __skeleton: true
  __index: number
}

const props = withDefaults(
  defineProps<{
    /** Array of data items to render */
    items: T[]
    /** Estimated height of each row in pixels */
    estimateSize?: number
    /** Number of items to render above/below the visible area */
    overscan?: number
    /** Fixed height of the table container. Use 'auto' for flex containers */
    height?: string | number
    /** Whether the table is currently loading */
    loading?: boolean
    /** Number of skeleton rows to show when loading */
    skeletonCount?: number
    /** Unique key extractor for each item */
    getItemKey?: (item: T, index: number) => string | number
    /** Whether to show the header */
    showHeader?: boolean
  }>(),
  {
    estimateSize: 72,
    overscan: 5,
    height: 500,
    loading: false,
    skeletonCount: 8,
    showHeader: true,
    getItemKey: (_item: T, index: number) => index,
  },
)

defineSlots<{
  /** Table header content */
  header(): unknown
  /** Row content - receives item and index */
  row(props: { item: T; index: number; style: Record<string, string> }): unknown
  /** Empty state content */
  empty(): unknown
  /** Skeleton row for loading state */
  skeleton(props: { index: number; style: Record<string, string> }): unknown
}>()

const parentRef = ref<HTMLElement | null>(null) as Ref<HTMLElement | null>

const displayItems = computed<Array<T | SkeletonItem>>(() => {
  if (props.loading) {
    return Array.from({ length: props.skeletonCount }, (_, i) => ({
      __skeleton: true,
      __index: i,
    }))
  }
  return props.items
})

function isSkeletonItem(item: T | SkeletonItem | undefined): item is SkeletonItem {
  return Boolean(item && typeof item === 'object' && '__skeleton' in item)
}

function getRenderableItem(index: number): T {
  const item = props.items[index]
  if (item === undefined) {
    throw new Error(`Missing virtual table item at index ${index}`)
  }
  return item
}

const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayItems.value.length,
    getScrollElement: () => parentRef.value,
    estimateSize: () => props.estimateSize,
    overscan: props.overscan,
    getItemKey: (index: number) => {
      const item = displayItems.value[index]
      if (isSkeletonItem(item)) {
        return `skeleton-${item.__index}`
      }
      if (item === undefined) return index
      return props.getItemKey(item, index)
    },
  })),
)

const virtualRows = computed(() => virtualizer.value.getVirtualItems())
const totalSize = computed(() => virtualizer.value.getTotalSize())

const containerHeight = computed(() => {
  if (props.height === 'auto') return 'auto'
  if (typeof props.height === 'number') return `${props.height}px`
  return props.height
})

// Expose scroll methods for external control
defineExpose({
  scrollToIndex: (index: number, options?: { align?: 'start' | 'center' | 'end' | 'auto' }) => {
    virtualizer.value.scrollToIndex(index, options)
  },
  scrollToOffset: (offset: number) => {
    virtualizer.value.scrollToOffset(offset)
  },
  scrollElement: parentRef,
})

// Watch for item changes to potentially scroll to top
watch(
  () => props.items.length,
  (newLen, oldLen) => {
    if (newLen !== oldLen && parentRef.value) {
      // Optionally reset scroll position when items change significantly
    }
  },
)
</script>

<template>
  <div class="virtual-table-container flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950/85 dark:shadow-[0_10px_30px_rgba(2,8,23,0.35)]">
    <!-- Fixed Header -->
    <div v-if="showHeader" class="virtual-table-header shrink-0 bg-slate-50 dark:bg-slate-900">
      <slot name="header" />
    </div>

    <!-- Scrollable Body -->
    <div
      ref="parentRef"
      class="virtual-table-body flex-1 overflow-auto"
      :style="{ height: containerHeight, maxHeight: containerHeight }"
    >
      <!-- Empty State -->
      <div v-if="!loading && items.length === 0" class="flex h-full items-center justify-center py-16">
        <slot name="empty">
          <div class="text-center text-slate-400 dark:text-slate-500">
            No records found
          </div>
        </slot>
      </div>

      <!-- Virtual List Container -->
      <div
        v-else
        class="virtual-table-list relative w-full"
        :style="{ height: `${totalSize}px` }"
      >
        <template v-for="virtualRow in virtualRows" :key="String(virtualRow.key)">
          <!-- Skeleton Row -->
          <template v-if="loading">
            <slot
              name="skeleton"
              :index="virtualRow.index"
              :style="{
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }"
            >
              <div
                class="virtual-table-skeleton-row flex items-center border-b border-slate-100 px-4 dark:border-slate-800"
                :style="{
                  position: 'absolute',
                  top: '0',
                  left: '0',
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }"
              >
                <div class="flex w-full animate-pulse items-center gap-4">
                  <div class="h-4 w-12 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="h-4 flex-1 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="h-4 w-24 rounded bg-slate-200 dark:bg-slate-700" />
                  <div class="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700" />
                </div>
              </div>
            </slot>
          </template>

          <!-- Data Row -->
          <template v-else>
            <slot
              name="row"
              :item="getRenderableItem(virtualRow.index)"
              :index="virtualRow.index"
              :style="{
                position: 'absolute',
                top: '0',
                left: '0',
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }"
            />
          </template>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.virtual-table-container {
  min-height: 0;
}

.virtual-table-body {
  will-change: scroll-position;
  -webkit-overflow-scrolling: touch;
}

.virtual-table-list {
  contain: layout;
}
</style>
