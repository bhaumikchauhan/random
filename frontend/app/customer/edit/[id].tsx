import { useLocalSearchParams } from "expo-router";
import CustomerForm from "@/src/screens/CustomerForm";
export default function EditCustomer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CustomerForm customerId={id} />;
}
