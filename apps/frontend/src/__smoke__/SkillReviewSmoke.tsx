import { useEffect, useState } from 'react';

interface ApiUser {
  id: string;
  name: string;
}

interface ApiOrder {
  id: string;
  active: boolean;
}

export function SkillReviewSmoke({ userId }: { userId: string }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [activeOrders, setActiveOrders] = useState<ApiOrder[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const u = (await fetch(`/api/users/${userId}`).then((r) =>
        r.json(),
      )) as ApiUser;
      const o = (await fetch(`/api/users/${userId}/orders`).then((r) =>
        r.json(),
      )) as ApiOrder[];
      if (!cancelled) {
        setUser(u);
        setOrders(o);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    setActiveOrders(orders.filter((x) => x.active));
  }, [orders]);

  return (
    <ul>
      {activeOrders.map((order) => (
        <li key={order.id}>
          {order.id} — {user?.name}
        </li>
      ))}
    </ul>
  );
}
