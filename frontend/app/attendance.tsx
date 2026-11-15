import { useAuth } from "@/src/auth";
import SalesmanAttendance from "@/src/screens/SalesmanAttendance";
import AdminAttendance from "@/src/screens/AdminAttendance";

export default function AttendanceRoute() {
  const { user } = useAuth();
  if (user?.role === "admin") return <AdminAttendance />;
  return <SalesmanAttendance />;
}
