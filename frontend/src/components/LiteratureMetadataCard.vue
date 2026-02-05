<script setup lang="ts">
import { computed } from 'vue'
import { BookOpen, User, Hash, Calendar, FileText, AlertCircle } from 'lucide-vue-next'
import type { LiteratureMetadata } from '@/lib/api'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Badge from '@/components/ui/Badge.vue'
import Input from '@/components/ui/Input.vue'

const props = defineProps<{
  metadata: LiteratureMetadata
  editable?: boolean
}>()

const emit = defineEmits<{
  'update:metadata': [metadata: LiteratureMetadata]
}>()

// 验证状态
const validation = computed(() => {
  const issues: string[] = []
  if (!props.metadata.doi || props.metadata.doi.trim() === '') {
    issues.push('DOI 缺失')
  }
  if (!props.metadata.title || props.metadata.title.trim() === '') {
    issues.push('标题缺失')
  }
  return {
    isValid: issues.length === 0,
    issues
  }
})

// 更新字段
function updateField(field: keyof LiteratureMetadata, value: string | number | null) {
  emit('update:metadata', {
    ...props.metadata,
    [field]: value
  })
}

// 格式化卷/期/页码
const volumeIssuePages = computed(() => {
  const parts: string[] = []
  if (props.metadata.volume) parts.push(`Vol. ${props.metadata.volume}`)
  if (props.metadata.issue) parts.push(`No. ${props.metadata.issue}`)
  if (props.metadata.pages) parts.push(`pp. ${props.metadata.pages}`)
  return parts.join(', ') || '-'
})
</script>

<template>
  <Card class="mb-4 border-l-4" :class="validation.isValid ? 'border-l-primary' : 'border-l-yellow-500'">
    <CardHeader class="pb-3">
      <div class="flex items-center justify-between">
        <CardTitle class="text-base flex items-center gap-2">
          <BookOpen class="h-4 w-4 text-primary" />
          文献信息
        </CardTitle>
        <div class="flex items-center gap-2">
          <Badge v-if="!validation.isValid" class="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
            <AlertCircle class="h-3 w-3 mr-1" />
            {{ validation.issues.join(', ') }}
          </Badge>
          <Badge v-else class="bg-green-500/10 text-green-600 border-green-500/20">
            ✓ 已验证
          </Badge>
        </div>
      </div>
    </CardHeader>
    
    <CardContent class="pt-0">
      <div class="space-y-3">
        <!-- 标题 -->
        <div class="group">
          <label class="text-xs text-muted-foreground mb-1 block">标题</label>
          <div v-if="!editable" class="font-medium text-sm leading-relaxed">
            {{ metadata.title || '-' }}
          </div>
          <Input 
            v-else
            :model-value="metadata.title"
            @update:model-value="updateField('title', $event)"
            placeholder="文献标题"
            :class="'text-sm' + (!metadata.title ? ' border-yellow-500' : '')"
          />
        </div>
        
        <!-- 作者和年份 -->
        <div class="grid grid-cols-2 gap-4">
          <div class="group">
            <label class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <User class="h-3 w-3" /> 作者
            </label>
            <div v-if="!editable" class="text-sm text-muted-foreground">
              {{ metadata.authors || '-' }}
            </div>
            <Input 
              v-else
              :model-value="metadata.authors"
              @update:model-value="updateField('authors', $event)"
              placeholder="作者列表"
              class="text-sm"
            />
          </div>
          
          <div class="group">
            <label class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar class="h-3 w-3" /> 年份
            </label>
            <div v-if="!editable" class="text-sm">
              {{ metadata.year }}
            </div>
            <Input 
              v-else
              type="number"
              :model-value="String(metadata.year)"
              @update:model-value="updateField('year', parseInt($event) || 2024)"
              placeholder="年份"
              class="text-sm w-24"
            />
          </div>
        </div>
        
        <!-- DOI 和期刊 -->
        <div class="grid grid-cols-2 gap-4">
          <div class="group">
            <label class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Hash class="h-3 w-3" /> DOI
            </label>
            <div v-if="!editable">
              <a 
                v-if="metadata.doi" 
                :href="`https://doi.org/${metadata.doi}`" 
                target="_blank"
                class="text-sm text-primary hover:underline"
              >
                {{ metadata.doi }}
              </a>
              <span v-else class="text-sm text-yellow-600">未提供</span>
            </div>
            <Input 
            v-else
            :model-value="metadata.doi"
            @update:model-value="updateField('doi', $event)"
            placeholder="10.xxxx/xxxxx"
            :class="'text-sm font-mono' + (!metadata.doi ? ' border-yellow-500' : '')"
            />
          </div>
          
          <div class="group">
            <label class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <FileText class="h-3 w-3" /> 期刊
            </label>
            <div v-if="!editable" class="text-sm italic">
              {{ metadata.journal || '-' }}
            </div>
            <Input 
              v-else
              :model-value="metadata.journal"
              @update:model-value="updateField('journal', $event)"
              placeholder="期刊名称"
              class="text-sm"
            />
          </div>
        </div>
        
        <!-- 卷/期/页码 (只读视图显示组合, 编辑时分开) -->
        <div v-if="!editable" class="text-xs text-muted-foreground">
          {{ volumeIssuePages }}
        </div>
        <div v-else class="grid grid-cols-3 gap-2">
          <div>
            <label class="text-xs text-muted-foreground mb-1 block">卷号</label>
            <Input 
              :model-value="metadata.volume || ''"
              @update:model-value="updateField('volume', $event || null)"
              placeholder="Vol."
              class="text-sm"
            />
          </div>
          <div>
            <label class="text-xs text-muted-foreground mb-1 block">期号</label>
            <Input 
              :model-value="metadata.issue || ''"
              @update:model-value="updateField('issue', $event || null)"
              placeholder="No."
              class="text-sm"
            />
          </div>
          <div>
            <label class="text-xs text-muted-foreground mb-1 block">页码</label>
            <Input 
              :model-value="metadata.pages || ''"
              @update:model-value="updateField('pages', $event || null)"
              placeholder="123-145"
              class="text-sm"
            />
          </div>
        </div>
      </div>
    </CardContent>
  </Card>
</template>
