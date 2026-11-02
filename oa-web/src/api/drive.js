import http from './client'

export const listRoot = () => http.get('/api/drive')
export const listFolder = (id) => http.get(`/api/drive/folder/${id}`)
export const breadcrumb = (id) => http.get(`/api/drive/breadcrumb/${id}`)

export const listAcl = (folderId) => http.get(`/api/drive/acl/${folderId}`)
export const setAcl = (folderId, body) => http.put(`/api/drive/acl/${folderId}`, body)
export const removeAcl = (folderId, userId) => http.delete(`/api/drive/acl/${folderId}/${userId}`)

// 通用人员列表（后端无额外权限门槛，供选人使用）
export const listUsers = () => http.get('/api/users')
