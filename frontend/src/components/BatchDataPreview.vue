<script setup lang="ts">
import { ref, computed } from 'vue'
import { Download, Beaker, ChevronDown, ChevronUp, Gauge, ThermometerSun, Timer, Layers, AlertCircle, CheckCircle2, Loader2, RefreshCw, Check } from 'lucide-vue-next'
import type { BatchFile, TribologyData, LiteratureMetadata } from '@/lib/api'
import { useValidation } from '@/composables/useValidation'
import EditableField from '@/components/EditableField.vue'
import LiteratureMetadataCard from '@/components/LiteratureMetadataCard.vue'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Button from '@/components/ui/Button.vue'
import Badge from '@/components/ui/Badge.vue'

const props = defineProps<{
  files: BatchFile[]
  loading?: boolean
}>()

const emit = defineEmits<{
  'export': [fileId: string]
  'retry': [fileId: string]
  'update:record': [fileId: string, recordId: string, record: TribologyData]
  'update:file': [fileId: string]
  'update:metadata': [fileId: string, metadata: LiteratureMetadata]
  'save': [fileId: string]
}>()

// Use validation composable
const { validateRecord } = useValidation()

const selectedFileId = ref<string | null>(null)
const expandedRows = ref<Set<string>>(new Set())

// 选中的文件
const selectedFile = computed(() => {
  if (!selectedFileId.value) return null
  return props.files.find(f => f.id === selectedFileId.value) || null
})

// 统计信息
const stats = computed(() => {
  const total = props.files.length
  const completed = props.files.filter(f => f.status === 'success').length
  const totalRecords = props.files.reduce((sum, f) => sum + f.records.length, 0)
  const withWarnings = props.files.filter(f => f.hasWarnings).length
  
  return { total, completed, totalRecords, withWarnings }
})

// 选择文件
function selectFile(fileId: string) {
  selectedFileId.value = fileId
}

// 切换行展开
function toggleRow(id: string) {
  if (expandedRows.value.has(id)) {
    expandedRows.value.delete(id)
  } else {
    expandedRows.value.add(id)
  }
}

// 解析 COF 值
function parseCof(cof: string | undefined): number | undefined {
  if (!cof) return undefined
  const numericStr = cof.replace(/[^\d.]/g, '')
  const val = parseFloat(numericStr)
  return isNaN(val) ? undefined : val
}

// COF 颜色
function getCofColor(cofStr: string | undefined): string {
  const cof = parseCof(cofStr)
  if (cof === undefined) return 'bg-muted'
  if (cof < 0.1) return 'bg-green-500'
  if (cof < 0.2) return 'bg-yellow-500'
  return 'bg-red-500'
}

// COF 宽度
function getCofWidth(cofStr: string | undefined): string {
  const cof = parseCof(cofStr)
  if (cof === undefined) return '0%'
  return `${Math.min(cof * 200, 100)}%`
}

// 获取文件状态图标
function getFileStatusIcon(file: BatchFile) {
  switch (file.status) {
    case 'processing': return Loader2
    case 'success': return file.hasWarnings ? AlertCircle : CheckCircle2
    case 'error': return AlertCircle
    default: return null
  }
}

// 获取文件状态颜色
function getFileStatusColor(file: BatchFile): string {
  switch (file.status) {
    case 'processing': return 'text-blue-500'
    case 'success': return file.hasWarnings ? 'text-yellow-500' : 'text-green-500'
    case 'error': return 'text-red-500'
    default: return 'text-muted-foreground'
  }
}

// 导出当前文件
function exportCurrentFile() {
  if (selectedFileId.value) {
    emit('export', selectedFileId.value)
  }
}

// 重试当前文件
function retryCurrentFile() {
  if (selectedFileId.value) {
    emit('retry', selectedFileId.value)
  }
}

// 判断是否为超润滑状态 (COF < 0.01)
function isSuperlubricity(cofStr: string | undefined): boolean {
  if (!cofStr) return false
  
  // 如果包含 "<" 符号,说明实际值小于显示值
  const hasLessThan = cofStr.includes('<')
  const cof = parseCof(cofStr)
  
  if (cof === undefined) return false
  
  // 如果有 "<" 符号且值 <= 0.01,或者值严格 < 0.01,都判定为超润滑
  return hasLessThan ? cof <= 0.01 : cof < 0.01
}

// 导出所有数据
function exportAllData() {
  const allRecords = props.files.flatMap(f => f.records)
  const jsonData = JSON.stringify(allRecords, null, 2)
  const blob = new Blob([jsonData], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tribology_data_all_${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// 更新记录并验证
function updateRecordField(recordId: string, fieldName: keyof TribologyData, value: string | undefined) {
  if (!selectedFile.value) return
  
  const record = selectedFile.value.records.find(r => r.id === recordId)
  if (!record) return
  
  // Store original value if first edit
  if (!record.originalValue) {
    record.originalValue = { ...record }
  }
  
  // Update the field
  ;(record as any)[fieldName] = value
  
  // Mark as modified
  record.validationStatus = 'modified'
  
  // Re-validate
  const validation = validateRecord(record)
  record.validationStatus = validation.status
  record.validationMessage = validation.message
  
  // Emit update
  emit('update:record', selectedFile.value.id, recordId, record)
}

// 验证单条记录
function verifyRecord(recordId: string) {
  if (!selectedFile.value) return
  
  const record = selectedFile.value.records.find(r => r.id === recordId)
  if (!record) return
  
  // 如果当前已经是 verified，点击则取消验证（这种交互更自然）
  if (record.validationStatus === 'verified') {
    const validation = validateRecord(record)
    record.validationStatus = validation.status
    record.validationMessage = validation.message
  } else {
    // 手动确认：强制标记为 verified
    record.validationStatus = 'verified'
    record.validationMessage = undefined
  }
  
  emit('update:record', selectedFile.value.id, recordId, record)
}


// 全部确认
function markAllAsVerified() {
  if (!selectedFile.value) return
  
  selectedFile.value.records.forEach(record => {
    const validation = validateRecord(record)
    
    // Only mark as verified if no severe issues
    if (validation.issues.every(i => i.severity !== 'error')) {
      record.validationStatus = 'verified'
      record.validationMessage = undefined
    }
  })
  
  emit('update:file', selectedFile.value.id)
}
</script>

<template>
  <Card class="h-full flex flex-col">
    <CardHeader class="flex-row items-center justify-between space-y-0 pb-4">
      <div>
        <CardTitle class="text-lg">提取数据预览</CardTitle>
        <p class="text-sm text-muted-foreground mt-1">
          共 {{ stats.totalRecords }} 条记录 · {{ stats.completed }}/{{ stats.total }} 文件已完成
        </p>
      </div>
      <Button
        v-if="stats.totalRecords > 0"
        size="sm"
        variant="outline"
        @click="exportAllData"
      >
        <Download class="h-4 w-4 mr-1" />
        全部导出
      </Button>
    </CardHeader>
    
    <CardContent class="flex-1 overflow-hidden pt-0 flex gap-4">
      <!-- 左侧：文件列表 -->
      <div class="w-72 flex flex-col border-r pr-4">
        <!-- 总进度 -->
        <div v-if="files.length > 0" class="mb-3">
          <div class="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>整体进度</span>
            <span>{{ stats.completed }}/{{ stats.total }}</span>
          </div>
          <div class="h-2 bg-muted rounded-full overflow-hidden">
            <div
              class="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-300"
              :style="{ width: `${(stats.completed / stats.total) * 100}%` }"
            />
          </div>
        </div>
        
        <!-- 文件列表 -->
        <div class="flex-1 overflow-y-auto space-y-2">
          <!-- 空状态 -->
          <div v-if="files.length === 0" class="h-full flex items-center justify-center">
            <div class="text-center">
              <Beaker class="mx-auto h-10 w-10 text-muted-foreground/50" />
              <p class="mt-2 text-xs text-muted-foreground">
                暂无文件
              </p>
            </div>
          </div>
          
          <!-- 文件项 -->
          <div
            v-for="file in files"
            :key="file.id"
            class="group relative p-3 rounded-lg border cursor-pointer transition-all hover:shadow-md"
            :class="[
              selectedFileId === file.id 
                ? 'bg-primary/5 border-primary ring-1 ring-primary' 
                : 'bg-card hover:bg-muted/50'
            ]"
            @click="selectFile(file.id)"
          >
            <div class="flex items-start gap-2">
              <!-- 状态图标 -->
              <component
                :is="getFileStatusIcon(file)"
                class="h-5 w-5 flex-shrink-0 mt-0.5"
                :class="[
                  getFileStatusColor(file),
                  file.status === 'processing' ? 'animate-spin' : ''
                ]"
              />
              
              <div class="flex-1 min-w-0">
                <!-- 文件名 -->
                <p class="text-sm font-medium truncate" :title="file.name">
                  {{ file.name }}
                </p>
                
                <!-- 记录数 & 警告 -->
                <div class="flex items-center gap-1.5 mt-1">
                  <Badge 
                    v-if="file.status === 'success' && file.records.length > 0"
                    class="bg-blue-500/10 text-blue-600 border-blue-500/20 text-xs"
                  >
                    {{ file.records.length }}
                  </Badge>
                  <Badge
                    v-if="file.hasWarnings"
                    class="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 text-xs"
                  >
                    含缺失值
                  </Badge>
                  <span v-if="file.errorMessage" class="text-xs text-red-500 truncate">
                    {{ file.errorMessage }}
                  </span>
                </div>
              </div>
            </div>
            
            <!-- 进度条（处理中时显示） -->
            <div v-if="file.status === 'processing'" class="mt-2">
              <div class="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  class="h-full bg-blue-500 transition-all duration-300"
                  :style="{ width: `${file.progress}%` }"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 右侧：详情视图 -->
      <div class="flex-1 flex flex-col min-w-0">
        <!-- 未选择文件 -->
        <div v-if="!selectedFile" class="h-full flex items-center justify-center">
          <div class="text-center">
            <Beaker class="mx-auto h-12 w-12 text-muted-foreground/50" />
            <p class="mt-3 text-sm font-medium">请选择文件查看详情</p>
            <p class="text-xs text-muted-foreground mt-1">
              点击左侧文件列表中的文件
            </p>
          </div>
        </div>
        
        <!-- 选中文件详情 -->
        <div v-else class="h-full flex flex-col">
          <!-- 头部操作栏 -->
          <div class="flex items-center justify-between mb-3 pb-3 border-b">
            <div>
              <h3 class="font-semibold truncate" :title="selectedFile.name">
                {{ selectedFile.name }}
              </h3>
              <p class="text-xs text-muted-foreground mt-0.5">
                {{ selectedFile.records.length }} 条记录
              </p>
            </div>
            <div class="flex gap-2">
              <Button
                v-if="selectedFile.status === 'success' && selectedFile.records.length > 0"
                size="sm"
                variant="outline"
                class="text-green-600 border-green-500 hover:bg-green-50"
                @click="markAllAsVerified"
              >
                <CheckCircle2 class="h-4 w-4 mr-1" />
                全部确认
              </Button>
              <Button
                v-if="selectedFile.status === 'success' && selectedFile.records.length > 0"
                size="sm"
                variant="outline"
                class="text-blue-600 border-blue-500 hover:bg-blue-50"
                @click="emit('save', selectedFile.id)"
              >
                <RefreshCw class="h-4 w-4 mr-1" />
                同步到数据库
              </Button>

              <Button
                v-if="selectedFile.status === 'error'"
                size="sm"
                variant="outline"
                @click="retryCurrentFile"
              >
                <RefreshCw class="h-4 w-4 mr-1" />
                重试
              </Button>
              <Button
                v-if="selectedFile.records.length > 0"
                size="sm"
                variant="outline"
                @click="exportCurrentFile"
              >
                <Download class="h-4 w-4 mr-1" />
                导出
              </Button>
            </div>
          </div>
          
          <!-- 数据卡片列表 -->
          <div class="flex-1 overflow-y-auto">
            <!-- 无数据 -->
            <div v-if="selectedFile.records.length === 0" class="h-full flex items-center justify-center">
              <div class="text-center">
                <AlertCircle class="mx-auto h-10 w-10 text-muted-foreground/50" />
                <p class="mt-2 text-sm text-muted-foreground">
                  该文件暂无提取数据
                </p>
              </div>
            </div>
            
          <!-- 文献信息卡片 -->
            <LiteratureMetadataCard
              v-if="selectedFile.metadata"
              :metadata="selectedFile.metadata"
              :editable="true"
              @update:metadata="(m) => selectedFile && emit('update:metadata', selectedFile.id, m)"
            />
            
            <!-- 数据列表 -->
            <div v-if="selectedFile.records.length > 0" class="space-y-3">
              <div
                v-for="item in selectedFile.records"
                :key="item.id"
                class="rounded-lg border bg-card overflow-hidden transition-all hover:shadow-md relative"
                :class="{
                  'border-l-4 border-l-green-500': item.validationStatus === 'verified',
                  'border-yellow-500 bg-yellow-50/30': item.validationStatus === 'warning',
                }"
              >
                <!-- Modified indicator -->
                <div
                  v-if="item.validationStatus === 'modified'"
                  class="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500"
                  title="已修改"
                />
                <!-- 主要信息行 -->
                <div
                  class="p-4 cursor-pointer"
                  @click="toggleRow(item.id!)"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="flex-1 min-w-0">
                      <!-- 材料名称 -->
                      <h4 class="font-semibold text-base truncate">
                        {{ item.material_name }}
                      </h4>
                      <!-- 离子液体 -->
                      <p class="text-sm text-muted-foreground mt-0.5">
                        {{ item.ionic_liquid }}
                      </p>
                      
                      <!-- 条件标签 -->
                      <div class="flex flex-wrap gap-1.5 mt-2">
                        <!-- 超润滑标签 -->
                        <Badge 
                          v-if="isSuperlubricity(item.cof)" 
                          class="bg-gradient-to-r from-pink-500/20 to-purple-500/20 text-pink-600 border-pink-500/30 font-semibold"
                        >
                          ✨ Superlubricity
                        </Badge>
                        <Badge v-if="item.load" class="bg-blue-500/10 text-blue-600 border-blue-500/20">
                          <Gauge class="w-3 h-3 mr-1" />
                          <EditableField
                            :model-value="item.load"
                            field-name="load"
                            :validation-status="item.validationStatus"
                            placeholder="-"
                            @update:model-value="(val) => updateRecordField(item.id!, 'load', val)"
                          />
                        </Badge>
                        <Badge v-if="item.temperature" class="bg-orange-500/10 text-orange-600 border-orange-500/20">
                          <ThermometerSun class="w-3 h-3 mr-1" />
                          <EditableField
                            :model-value="item.temperature"
                            field-name="temperature"
                            :validation-status="item.validationStatus"
                            placeholder="-"
                            @update:model-value="(val) => updateRecordField(item.id!, 'temperature', val)"
                          />
                        </Badge>
                        <Badge v-if="item.speed" class="bg-purple-500/10 text-purple-600 border-purple-500/20">
                          <Timer class="w-3 h-3 mr-1" />
                          <EditableField
                            :model-value="item.speed"
                            field-name="speed"
                            :validation-status="item.validationStatus"
                            placeholder="-"
                            @update:model-value="(val) => updateRecordField(item.id!, 'speed', val)"
                          />
                        </Badge>
                        <Badge v-if="item.contact_type" class="bg-green-500/10 text-green-600 border-green-500/20">
                          <Layers class="w-3 h-3 mr-1" />
                          {{ item.contact_type }}
                        </Badge>
                      </div>
                    </div>
                    
                    <!-- COF 显示 -->
                    <div class="flex flex-col items-end gap-2">
                      <!-- Verify button -->
                      <Button
                        size="sm"
                        variant="ghost"
                        class="h-6 w-6 p-0"
                        :class="item.validationStatus === 'verified' ? 'text-green-600 hover:text-green-700' : 'text-muted-foreground hover:text-primary'"
                        @click.stop="verifyRecord(item.id!)"
                        :title="item.validationStatus === 'verified' ? '已验证' : '标记为已验证'"
                      >
                        <Check class="h-4 w-4" />
                      </Button>
                      
                      <div class="text-right">
                        <p class="text-xs text-muted-foreground">COF</p>
                        <div class="text-lg font-bold">
                          <EditableField
                            :model-value="item.cof"
                            field-name="cof"
                            :validation-status="item.validationStatus"
                            :validation-message="item.validationMessage"
                            placeholder="-"
                            @update:model-value="(val) => updateRecordField(item.id!, 'cof', val)"
                          />
                        </div>
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
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
