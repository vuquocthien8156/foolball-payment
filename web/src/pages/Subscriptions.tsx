import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useGroupPath } from "@/contexts/GroupContext";

const Subscriptions = () => {
  const groupPath = useGroupPath();
  const navigate = useNavigate();

  useEffect(() => {
    navigate(groupPath("admin/bills?tab=recurring"), { replace: true });
  }, [groupPath, navigate]);

  return null;
};

export default Subscriptions;
