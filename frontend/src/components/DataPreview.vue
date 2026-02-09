<script setup lang="ts">
import { ref, computed } from 'vue'
import { Download, ChevronDown, ChevronUp, Beaker, ThermometerSun, Gauge, Timer, Layers } from 'lucide-vue-next'
import type { TribologyData } from '@/lib/api'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'
import Spinner from '@/components/ui/Spinner.vue'

const props = defineProps<{
  data: TribologyData[]
  loading?: boolean
}>()

const expandedRows = ref<Set<string>>(new Set())

const hasData = computed(() => props.data.length > 0)

function toggleRow(id: string) {
  if (expandedRows.value.has(id)) {
    expandedRows.value.delete(id)
  } else {
    expandedRows.value.add(id)
  }
}

function parseCof(cof: string | undefined): number | undefined {
  if (!cof) return undefined
  // 移除非数字字符（保留小数点），比如 '<0.01' 变成 '0.01'
  const numericStr = cof.replace(/[^\d.]/g, '')
  const val = parseFloat(numericStr)
  return isNaN(val) ? undefined : val
}

function getCofColor(cofStr: string | undefined): string {
  const cof = parseCof(cofStr)
  if (cof === undefined) return 'bg-muted'
  if (cof < 0.1) return 'bg-green-500'
  if (cof < 0.2) return 'bg-yellow-500'
  return 'bg-red-500'
}

function getCofWidth(cofStr: string | undefined): string {
  const cof = parseCof(cofStr)
  if (cof === undefined) return '0%'
  return `${Math.min(cof * 200, 100)}%`
}

function exportData() {
  const jsonData = JSON.stringify(props.data, null, 2)
  const blob = new Blob([jsonData], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tribology_data_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <Card class="h-full flex flex-col">
    <CardHeader class="flex-row items-center justify-between space-y-0 pb-4">
      <div>
        <CardTitle class="text-lg">提取数据预览</CardTitle>
        <p class="text-sm text-muted-foreground mt-1">
          共 {{ data.length }} 条记录
        </p>
      </div>
      <Button
        v-if="hasData"
        size="sm"
        variant="outline"
        @click="exportData"
      >
        <Download class="h-4 w-4 mr-1" />
        导出
      </Button>
    </CardHeader>
    
    <CardContent class="flex-1 overflow-auto pt-0">
      <!-- 加载状态 -->
      <div v-if="loading" class="h-full flex items-center justify-center">
        <div class="text-center">
          <Spinner size="lg" class="mx-auto text-primary" />
          <p class="mt-3 text-sm text-muted-foreground">正在提取数据...</p>
        </div>
      </div>
      
      <!-- 空状态 -->
      <div v-else-if="!hasData" class="h-full flex items-center justify-center">
        <div class="text-center">
          <Beaker class="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p class="mt-3 text-sm text-muted-foreground">
            暂无提取数据
          </p>
          <p class="text-xs text-muted-foreground mt-1">
            上传文献并点击"提取"开始
          </p>
        </div>
      </div>
      
      <!-- 数据列表 -->
      <div v-else class="space-y-3">
        <div
          v-for="item in data"
          :key="item.id"
          class="rounded-lg border bg-card overflow-hidden transition-all hover:shadow-md"
        >
          <!-- 主要信息行 -->
          <div
            class="p-4 cursor-pointer"
            @click="toggleRow(item.id!)"
          >
            <div class="flex items-start justify-between gap-4">
              <div class="flex-1 min-w-0">
                <!-- 离子液体 -->
                <h4 class="font-semibold text-base truncate">
                  {{ item.ionic_liquid || '-' }}
                </h4>
                <!-- 材料名称/表面 -->
                <p class="text-sm text-muted-foreground mt-0.5">
                  {{ item.material_name }}
                </p>
                
                <!-- 条件标签 -->
                <div class="flex flex-wrap gap-1.5 mt-2">
                  <Badge v-if="item.load" class="bg-blue-500/10 text-blue-600 border-blue-500/20">
                    <Gauge class="w-3 h-3 mr-1" />
                    {{ item.load }}
                  </Badge>
                  <Badge v-if="item.temperature" class="bg-orange-500/10 text-orange-600 border-orange-500/20">
                    <ThermometerSun class="w-3 h-3 mr-1" />
                    {{ item.temperature }}
                  </Badge>
                  <Badge v-if="item.speed" class="bg-purple-500/10 text-purple-600 border-purple-500/20">
                    <Timer class="w-3 h-3 mr-1" />
                    {{ item.speed }}
                  </Badge>
                  <Badge v-if="item.contact_type" class="bg-green-500/10 text-green-600 border-green-500/20">
                    <Layers class="w-3 h-3 mr-1" />
                    {{ item.contact_type }}
                  </Badge>
                </div>
              </div>
              
              <!-- COF 显示 -->
              <div class="flex flex-col items-end gap-2">
                <div class="text-right">
                  <p class="text-xs text-muted-foreground">COF</p>
                  <p class="text-lg font-bold">
                    {{ item.cof ?? '-' }}
                  </p>
                </div>
                <!-- COF 条形图 -->
                <div class="w-20 h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    class="h-full transition-all duration-300"
                    :class="getCofColor(item.cof)"
                    :style="{ width: getCofWidth(item.cof) }"
                  />
                </div>
                
                <component
                  :is="expandedRows.has(item.id!) ? ChevronUp : ChevronDown"
                  class="w-5 h-5 text-muted-foreground"
                />
              </div>
            </div>
          </div>
          
          <!-- 展开详情 -->
          <div
            v-if="expandedRows.has(item.id!)"
            class="px-4 pb-4 pt-0 border-t bg-muted/30"
          >
            <div class="grid grid-cols-2 gap-3 text-sm pt-3">
              <div v-if="item.base_oil">
                <span class="text-muted-foreground">基础油:</span>
                <span class="ml-2">{{ item.base_oil }}</span>
              </div>
              <div v-if="item.concentration">
                <span class="text-muted-foreground">浓度:</span>
                <span class="ml-2">{{ item.concentration }}</span>
              </div>
              <div v-if="item.potential">
                <span class="text-muted-foreground">电位:</span>
                <span class="ml-2">{{ item.potential }}</span>
              </div>
              <div v-if="item.water_content">
                <span class="text-muted-foreground">含水量/湿度:</span>
                <span class="ml-2">{{ item.water_content }}</span>
              </div>
              <div v-if="item.surface_roughness">
                <span class="text-muted-foreground">表面粗糙度:</span>
                <span class="ml-2">{{ item.surface_roughness }}</span>
              </div>
              <div v-if="item.wear_rate">
                <span class="text-muted-foreground">磨损率:</span>
                <span class="ml-2">{{ item.wear_rate }}</span>
              </div>
              <div v-if="item.test_duration">
                <span class="text-muted-foreground">测试时间:</span>
                <span class="ml-2">{{ item.test_duration }}</span>
              </div>
              <div v-if="item.source" class="col-span-2">
                <span class="text-muted-foreground">来源:</span>
                <span class="ml-2">{{ item.source }}</span>
              </div>
              <div v-if="item.notes" class="col-span-2">
                <span class="text-muted-foreground">备注:</span>
                <span class="ml-2">{{ item.notes }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
