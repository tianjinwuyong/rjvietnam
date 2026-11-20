// ACL「可授权」逻辑隔离测试：直接调用 drive-service，不启服务
import { pathToFileURL } from 'node:url'

const SERVER = 'D:/Program Files/OA/app/server'
const svc = await import(pathToFileURL(`${SERVER}/src/services/drive-service.js`).href)
const db = await import(pathToFileURL(`${SERVER}/src/db/index.js`).href)

const { query } = db
const results = []
function ok(name, cond, extra = '') {
  results.push({ name, pass: !!cond })
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
}

async function main() {
  const admin = (await db.one(`SELECT id FROM org_user WHERE is_admin=TRUE AND active=TRUE ORDER BY id LIMIT 1`))
  const normals = (await db.many(`SELECT id, real_name FROM org_user WHERE is_admin=FALSE AND active=TRUE ORDER BY id LIMIT 4`))
  if (!admin || normals.length < 3) {
    console.log('跳过：缺少 admin 或普通用户')
    return
  }
  const [U, V, W] = normals
  const adminUser = { id: admin.id, isAdmin: true }
  console.log(`测试用户: admin=${admin.id}, B=${U.id}(${U.real_name}), C=${V.id}(${V.real_name}), D=${W.id}(${W.real_name})`)

  // 建一个临时根文件夹（parentId=null 不做权限校验）
  const folder = await svc.createFolder({ parentId: null, name: `__acl_test_${Date.now()}` }, adminUser)
  const fid = folder.id
  console.log('临时文件夹 id =', fid)

  try {
    // 1) 管理员给 B 授予「全部 5 项」但不显式传 canGrant → 应自动可授权
    await svc.setAcl(fid, {
      userId: U.id, canRead: true, canEdit: true, canUpload: true, canDelete: true, canCreate: true,
    }, adminUser)
    let acl = await svc.listAcl(fid, adminUser)
    let bRow = acl.list.find((r) => r.user_id === U.id)
    ok('全部 5 项 → 自动 can_grant=true', bRow && bRow.can_grant === true)

    // 2) B（被委派者）应能管理该文件夹权限
    const effB = await svc.effectiveAcl(fid, { id: U.id, isAdmin: false })
    ok('B 的有效 canGrant=true', effB.canGrant === true)

    // 3) B 给 C 授予只读
    await svc.setAcl(fid, {
      userId: V.id, canRead: true, canEdit: false, canUpload: false, canDelete: false, canCreate: false, canGrant: false,
    }, { id: U.id, isAdmin: false })
    acl = await svc.listAcl(fid, { id: U.id, isAdmin: false })
    ok('B 成功给 C 授权（只读）', acl.list.some((r) => r.user_id === V.id && r.can_read === true))

    // 4) 防提权：管理员给 D「只读 + 可授权」（部分权限也能显式给 canGrant）
    await svc.setAcl(fid, {
      userId: W.id, canRead: true, canEdit: false, canUpload: false, canDelete: false, canCreate: false, canGrant: true,
    }, adminUser)
    let denied = false
    try {
      await svc.setAcl(fid, { userId: V.id, canRead: true, canUpload: true, canGrant: false }, { id: W.id, isAdmin: false })
    } catch (e) {
      denied = /未拥有/.test(e.message)
    }
    ok('防提权：D 不能授出自己不拥有的上传权限', denied)

    // 5) 级联撤销：管理员撤销 B → C（B 授予）应一并失效
    await svc.removeAcl(fid, U.id, adminUser)
    acl = await svc.listAcl(fid, adminUser)
    const bGone = !acl.list.some((r) => r.user_id === U.id)
    const cGone = !acl.list.some((r) => r.user_id === V.id)
    ok('撤销 B 后 B 权限消失', bGone)
    ok('级联撤销：C 的权限随之消失', cGone)

    // 6) 非所有者越权：B 已无权，不能再管理
    let forbidden = false
    try {
      await svc.listAcl(fid, { id: U.id, isAdmin: false })
    } catch (e) {
      forbidden = e.statusCode === 403
    }
    ok('B 被撤销后失去权限管理权（403）', forbidden)
  } finally {
    await query(`DELETE FROM drive_folder WHERE id=$1`, [fid])
    console.log('已清理临时文件夹')
  }
}

try {
  await main()
} catch (e) {
  console.error('测试异常:', e)
  process.exitCode = 1
} finally {
  const pass = results.filter((r) => r.pass).length
  console.log(`\n结果: ${pass}/${results.length} 通过`)
  if (db.pool) await db.pool.end()
}
