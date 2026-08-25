import { useEffect, useState } from "react";
import { apiClient } from "../api";

type UserRow = {
  id: string;
  username: string;
  displayName: string;
  roleKey: string;
  status: string;
};

type RoleRow = {
  id: string;
  roleKey: string;
  name_zh: string;
  permissions: string[];
};

export function UserAuthorizationManager() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");

  const load = async () => {
    const [userResult, roleResult] = await Promise.all([
      apiClient.get<{ items: UserRow[] }>("/admin/users?limit=500"),
      apiClient.get<{ items: RoleRow[] }>("/admin/roles"),
    ]);
    setUsers(userResult.items);
    setRoles(roleResult.items);
    setDraft(Object.fromEntries(userResult.items.map((user) => [user.id, user.roleKey])));
  };

  useEffect(() => {
    load().catch((error) => setMessage(String(error)));
  }, []);

  const save = async (user: UserRow) => {
    setMessage("");
    await apiClient.patch(`/admin/users/${user.id}/role`, { roleKey: draft[user.id] });
    setMessage(`已更新 ${user.displayName} 的授权`);
    await load();
  };

  return (
    <div className="screen-stack">
      <div className="surface-panel">
        <h3>用户授权分配</h3>
        <p>蒙营可为任何用户分配系统角色。每次变更均写入审计记录。</p>
        {message && <p>{message}</p>}
        <div style={{ overflowX: "auto" }}>
          <table>
            <thead>
              <tr><th>用户</th><th>姓名</th><th>当前角色</th><th>分配角色</th><th>操作</th></tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  <td>{user.username}</td>
                  <td>{user.displayName}</td>
                  <td>{user.roleKey}</td>
                  <td>
                    <select
                      value={draft[user.id] ?? user.roleKey}
                      disabled={user.username === "MENG_YING"}
                      onChange={(event) => setDraft((old) => ({ ...old, [user.id]: event.target.value }))}
                    >
                      {roles.map((role) => (
                        <option key={role.roleKey} value={role.roleKey}>
                          {role.name_zh || role.roleKey} ({role.permissions.length})
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      disabled={user.username === "MENG_YING" || draft[user.id] === user.roleKey}
                      onClick={() => save(user).catch((error) => setMessage(String(error)))}
                    >
                      保存授权
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
