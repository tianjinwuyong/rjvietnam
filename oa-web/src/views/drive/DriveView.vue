<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Folder, Document, Lock, Refresh, ArrowLeft, Setting } from '@element-plus/icons-vue'
import * as api from '@/api/drive'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const auth = useAuthStore()

const loading = ref(false)
const currentId = ref(null)
const folder = ref(null)
const perm = ref({})
const subfolders = ref([])
const files = ref([])
const crumbs = ref([])
const rootFolders = ref([])

const canManage = computed(() => !!(perm.value.isOwner || perm.value.canGrant))

function fmtSize(n) {
  if (n == null) return '—'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

async function loadRoot() {
  loading.value = true
  try {
    currentId.value = null
    folder.value = null
    perm.value = {}
    subfolders.value = []
    files.value = []
    crumbs.value = []
    rootFolders.value = (await api.listRoot()) || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

async function openFolder(id) {
  loading.value = true
  try {
    const data = await api.listFolder(id)
    currentId.value = id
    folder.value = data.folder
    perm.value = data.perm || {}
    subfolders.value = data.subfolders || []
    files.value = data.files || []
    crumbs.value = (await api.breadcrumb(id)) || []
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    loading.value = false
  }
}

function goUp() {
  if (crumbs.value.length > 1) openFolder(crumbs.value[crumbs.value.length - 2].id)
  else loadRoot()
}

/* ---------------- 权限管理 ---------------- */
const aclVisible = ref(false)
const aclLoading = ref(false)
const aclList = ref([])
const aclMeta = ref({ isOwner: false, canGrant: false, ownerId: null })
const users = ref([])
const submitting = ref(false)

const blankForm = () => ({
  userId: null,
  canRead: true,
  canEdit: false,
  canUpload: false,
  canDelete: false,
  canCreate: false,
  canGrant: false,
})
const form = ref(blankForm())
const suppressAuto = ref(false)

const allFive = computed(
  () => form.value.canRead && form.value.canEdit && form.value.canUpload && form.value.canDelete && form.value.canCreate
)
// 5 项全勾 → 自动勾上「可授权」（仅新增时；编辑既有记录不自动翻转）
watch(allFive, (v, old) => {
  if (v && !old && !suppressAuto.value) form.value.canGrant = true
})

const selectableUsers = computed(() =>
  (users.value || []).filter(
    (u) =>
      u.active !== false &&
      !u.is_admin &&
      u.id !== aclMeta.value.ownerId &&
      u.id !== auth.user?.id
  )
)

async function openAcl() {
  if (!currentId.value) return
  aclVisible.value = true
  aclLoading.value = true
  form.value = blankForm()
  suppressAuto.value = false
  try {
    const data = await api.listAcl(currentId.value)
    aclList.value = data.list || []
    aclMeta.value = {
      isOwner: !!data.isOwner,
      canGrant: !!data.canGrant,
      ownerId: data.ownerId,
    }
    if (!users.value.length) users.value = (await api.listUsers()) || []
  } catch (e) {
    ElMessage.error(e.message)
    aclVisible.value = false
  } finally {
    aclLoading.value = false
  }
}

async function refreshAcl() {
  const data = await api.listAcl(currentId.value)
  aclList.value = data.list || []
}

function editRow(row) {
  suppressAuto.value = true
  form.value = {
    userId: row.user_id,
    canRead: !!row.can_read,
    canEdit: !!row.can_edit,
    canUpload: !!row.can_upload,
    canDelete: !!row.can_delete,
    canCreate: !!row.can_create,
    canGrant: !!row.can_grant,
  }
}

async function submit() {
  if (!form.value.userId) {
    ElMessage.warning(t('drive.selectRequired'))
    return
  }
  submitting.value = true
  try {
    await api.setAcl(currentId.value, { ...form.value })
    ElMessage.success(t('drive.saved'))
    form.value = blankForm()
    suppressAuto.value = false
    await refreshAcl()
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    submitting.value = false
  }
}

async function removeRow(row) {
  try {
    await ElMessageBox.confirm(t('drive.confirmRemove'), t('drive.permission'), { type: 'warning' })
  } catch {
    return
  }
  try {
    await api.removeAcl(currentId.value, row.user_id)
    ElMessage.success(t('drive.removed'))
    await refreshAcl()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

function userLabel(row) {
  return row.real_name || row.username || row.dept_name || row.role_code || '-'
}

onMounted(loadRoot)
</script>

<template>
  <div class="oa-page">
    <div class="topbar">
      <div class="left">
        <el-button v-if="currentId" :icon="ArrowLeft" text @click="goUp">{{ t('drive.back') }}</el-button>
        <el-breadcrumb separator="/">
          <el-breadcrumb-item>
            <a class="crumb" @click="loadRoot">{{ t('drive.root') }}</a>
          </el-breadcrumb-item>
          <el-breadcrumb-item v-for="c in crumbs" :key="c.id">
            <a class="crumb" @click="openFolder(c.id)">{{ c.name }}</a>
          </el-breadcrumb-item>
        </el-breadcrumb>
      </div>
      <div class="right">
        <el-button :icon="Refresh" @click="currentId ? openFolder(currentId) : loadRoot()">
          {{ t('drive.refresh') }}
        </el-button>
        <el-button v-if="currentId && canManage" type="primary" :icon="Lock" @click="openAcl">
          {{ t('drive.permission') }}
        </el-button>
      </div>
    </div>

    <div v-loading="loading">
      <!-- 根目录 -->
      <template v-if="!currentId">
        <div class="section-title">{{ t('drive.root') }}</div>
        <div v-if="rootFolders.length" class="folder-grid">
          <div v-for="f in rootFolders" :key="f.id" class="folder-card" @click="openFolder(f.id)">
            <el-icon class="folder-icon" :size="26"><Folder /></el-icon>
            <div class="folder-name">{{ f.name }}</div>
            <div class="folder-meta">{{ f.owner_name || '' }}</div>
          </div>
        </div>
        <el-empty v-else :description="t('drive.empty')" />
      </template>

      <!-- 文件夹内 -->
      <template v-else>
        <div class="folder-head">
          <h2 class="folder-title">
            <el-icon><Folder /></el-icon>
            {{ folder?.name }}
          </h2>
          <div class="badges">
            <el-checkbox :model-value="perm.canRead" disabled>{{ t('drive.readOnly') }}</el-checkbox>
            <el-checkbox :model-value="perm.canEdit" disabled>{{ t('drive.editUpdate') }}</el-checkbox>
            <el-checkbox :model-value="perm.canUpload" disabled>{{ t('drive.upload') }}</el-checkbox>
            <el-checkbox :model-value="perm.canDelete" disabled>{{ t('drive.del') }}</el-checkbox>
            <el-checkbox :model-value="perm.canCreate" disabled>{{ t('drive.createSub') }}</el-checkbox>
            <el-checkbox :model-value="perm.canGrant" disabled>{{ t('drive.canGrant') }}</el-checkbox>
          </div>
        </div>

        <template v-if="subfolders.length">
          <div class="section-title">{{ t('drive.subfolders') }}</div>
          <div class="folder-grid">
            <div v-for="sf in subfolders" :key="sf.id" class="folder-card" @click="openFolder(sf.id)">
              <el-icon class="folder-icon" :size="26"><Folder /></el-icon>
              <div class="folder-name">{{ sf.name }}</div>
              <div class="folder-meta">{{ sf.owner_name || '' }}</div>
            </div>
          </div>
        </template>

        <div class="section-title">{{ t('drive.files') }}</div>
        <el-table :data="files" size="default" border empty-text=" ">
          <el-table-column :label="t('drive.file')" min-width="260">
            <template #default="{ row }">
              <span class="file-name"><el-icon><Document /></el-icon> {{ row.name }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="t('drive.size')" width="120">
            <template #default="{ row }">{{ fmtSize(row.file_size) }}</template>
          </el-table-column>
          <el-table-column :label="t('drive.uploader')" width="140">
            <template #default="{ row }">{{ row.uploader_name || '—' }}</template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!files.length && !subfolders.length" :description="t('drive.empty')" />
      </template>
    </div>

    <!-- 权限管理对话框 -->
    <el-dialog v-model="aclVisible" :title="t('drive.permTitle')" width="820px" top="7vh">
      <div v-loading="aclLoading">
        <div class="add-box">
          <div class="add-title">{{ t('drive.addUserAuth') }}</div>
          <div class="add-row">
            <el-select
              v-model="form.userId"
              filterable
              clearable
              :placeholder="t('drive.selectUser')"
              class="user-select"
            >
              <el-option
                v-for="u in selectableUsers"
                :key="u.id"
                :value="u.id"
                :label="`${u.real_name || u.username}${u.dept_name ? '（' + u.dept_name + '）' : ''}`"
              />
            </el-select>
            <el-checkbox v-model="form.canRead">{{ t('drive.readOnly') }}</el-checkbox>
            <el-checkbox v-model="form.canEdit">{{ t('drive.editUpdate') }}</el-checkbox>
            <el-checkbox v-model="form.canUpload">{{ t('drive.upload') }}</el-checkbox>
            <el-checkbox v-model="form.canDelete">{{ t('drive.del') }}</el-checkbox>
            <el-checkbox v-model="form.canCreate">{{ t('drive.createSub') }}</el-checkbox>
            <el-checkbox v-model="form.canGrant" class="grant-check">{{ t('drive.canGrant') }}</el-checkbox>
            <el-button type="primary" :loading="submitting" @click="submit">
              {{ t('drive.add') }}
            </el-button>
          </div>
          <div class="hint">{{ t('drive.grantHint') }}</div>
        </div>

        <el-table :data="aclList" size="small" border empty-text=" ">
          <el-table-column :label="t('drive.user')" min-width="150">
            <template #default="{ row }">
              <div class="u-name">{{ userLabel(row) }}</div>
              <div class="u-dept">{{ row.dept_name || '' }}</div>
            </template>
          </el-table-column>
          <el-table-column align="center" width="70">
            <template #header><el-icon><Lock /></el-icon></template>
            <template #default="{ row }"><el-checkbox :model-value="!!row.can_read" disabled /></template>
          </el-table-column>
          <el-table-column :label="t('drive.editUpdate')" align="center" width="90">
            <template #default="{ row }"><el-checkbox :model-value="!!row.can_edit" disabled /></template>
          </el-table-column>
          <el-table-column :label="t('drive.upload')" align="center" width="70">
            <template #default="{ row }"><el-checkbox :model-value="!!row.can_upload" disabled /></template>
          </el-table-column>
          <el-table-column :label="t('drive.del')" align="center" width="70">
            <template #default="{ row }"><el-checkbox :model-value="!!row.can_delete" disabled /></template>
          </el-table-column>
          <el-table-column :label="t('drive.createSub')" align="center" width="110">
            <template #default="{ row }"><el-checkbox :model-value="!!row.can_create" disabled /></template>
          </el-table-column>
          <el-table-column :label="t('drive.canGrant')" align="center" width="90">
            <template #default="{ row }">
              <el-tag :type="row.can_grant ? 'success' : 'info'" size="small" effect="plain">
                {{ row.can_grant ? '✓' : '—' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column :label="t('drive.grantedBy')" width="100">
            <template #default="{ row }">{{ row.granted_by_name || '—' }}</template>
          </el-table-column>
          <el-table-column :label="t('drive.action')" width="130" fixed="right">
            <template #default="{ row }">
              <el-button size="small" text type="primary" :disabled="!row.manageable" @click="editRow(row)">
                {{ t('drive.edit') }}
              </el-button>
              <el-button size="small" text type="danger" :disabled="!row.manageable" @click="removeRow(row)">
                {{ t('drive.remove') }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="hint owner-hint">{{ t('drive.ownerHint') }}</div>
        <div v-if="!aclMeta.isOwner" class="hint">{{ t('drive.notManageable') }}</div>
      </div>
      <template #footer>
        <el-button @click="aclVisible = false">{{ t('drive.close') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.topbar .left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.topbar .right {
  display: flex;
  gap: 8px;
}
.crumb {
  cursor: pointer;
  color: var(--oa-brand);
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  margin: 8px 0 12px;
}
.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}
.folder-card {
  background: #fff;
  border: 1px solid var(--oa-border);
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;
}
.folder-card:hover {
  border-color: var(--oa-brand);
  box-shadow: var(--oa-shadow);
  transform: translateY(-1px);
}
.folder-icon {
  color: #f0b429;
}
.folder-name {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 600;
  word-break: break-all;
}
.folder-meta {
  margin-top: 4px;
  font-size: 12px;
  color: var(--oa-text-secondary);
}
.folder-head {
  background: #fff;
  border: 1px solid var(--oa-border);
  border-radius: 10px;
  padding: 14px 18px;
  margin-bottom: 16px;
}
.folder-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  margin: 0 0 10px;
}
.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 14px;
}
.file-name {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.add-box {
  background: #f8fafc;
  border: 1px solid var(--oa-border);
  border-radius: 10px;
  padding: 14px 16px;
  margin-bottom: 16px;
}
.add-title {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 10px;
}
.add-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 14px;
}
.user-select {
  width: 220px;
}
.grant-check :deep(.el-checkbox__label) {
  color: #b45309;
  font-weight: 600;
}
.hint {
  font-size: 12px;
  color: var(--oa-text-secondary);
  margin-top: 10px;
}
.owner-hint {
  margin-top: 14px;
}
.u-name {
  font-size: 13px;
}
.u-dept {
  font-size: 12px;
  color: var(--oa-text-secondary);
}
</style>
