import { Navigate, useLocation } from "react-router-dom";

const Login = () => {
  const { search } = useLocation();
  return <Navigate to={`/platform/login${search}`} replace />;
};
export default Login;
