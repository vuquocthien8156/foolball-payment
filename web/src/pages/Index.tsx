import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Users, Trophy, CreditCard, TrendingUp } from "lucide-react";
import { Link } from "react-router-dom";

const Index = () => {
  const features = [
    {
      icon: Users,
      title: "Quản lý thành viên",
      description: "Lưu trữ danh sách người chơi để chọn nhanh mỗi trận",
      link: "/members",
    },
    {
      icon: Trophy,
      title: "Tạo trận đấu",
      description: "Phân chia đội và tính tiền tự động cho từng người",
      link: "/setup",
    },
    {
      icon: CreditCard,
      title: "Thanh toán online",
      description: "Link thanh toán PayOS tiện lợi cho mọi thành viên",
      link: "/pay",
    },
    {
      icon: TrendingUp,
      title: "Theo dõi realtime",
      description: "Dashboard cập nhật trạng thái thanh toán ngay lập tức",
      link: "/dashboard",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-secondary/30 to-background">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-primary opacity-5" />
        <div className="container mx-auto px-4 py-20 text-center relative">
          <div className="inline-flex items-center justify-center p-4 bg-primary rounded-2xl shadow-card mb-6">
            <Trophy className="h-12 w-12 text-white" />
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-foreground mb-6">
            Chia Tiền Đá Bóng
          </h1>
          <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
            Quản lý và thanh toán chi phí trận đá bóng một cách dễ dàng, minh
            bạch với PayOS
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild size="lg" className="text-lg h-14 px-8">
              <Link to="/setup">
                <Trophy className="h-5 w-5 mr-2" />
                Tạo trận đấu ngay
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="lg"
              className="text-lg h-14 px-8"
            >
              <Link to="/members">
                <Users className="h-5 w-5 mr-2" />
                Quản lý thành viên
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="container mx-auto px-4 py-16 max-w-6xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Tính năng nổi bật
          </h2>
          <p className="text-muted-foreground text-lg">
            Giải pháp hoàn hảo cho việc quản lý chi phí đá bóng nhóm
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <Link key={index} to={feature.link}>
              <Card className="h-full shadow-card hover:shadow-card-hover transition-all cursor-pointer group">
                <CardHeader>
                  <div className="h-12 w-12 rounded-xl bg-primary flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-card">
                    <feature.icon className="h-6 w-6 text-white" />
                  </div>
                  <CardTitle className="text-xl">{feature.title}</CardTitle>
                  <CardDescription className="text-base">
                    {feature.description}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* How It Works */}
      <div className="container mx-auto px-4 py-16 max-w-4xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-foreground mb-4">
            Cách sử dụng
          </h2>
        </div>

        <div className="space-y-8">
          {[
            {
              step: "01",
              title: "Thêm thành viên",
              description:
                "Lưu danh sách người chơi với tên và biệt danh để dễ dàng quản lý",
            },
            {
              step: "02",
              title: "Tạo trận & phân đội",
              description:
                "Kéo thả thành viên vào các đội, nhập tổng tiền và % phân chia",
            },
            {
              step: "03",
              title: "Gửi link thanh toán",
              description:
                "Chia sẻ link cho thành viên, họ chọn tên và thanh toán qua PayOS",
            },
            {
              step: "04",
              title: "Theo dõi realtime",
              description:
                "Xem dashboard cập nhật trạng thái thanh toán của từng người",
            },
          ].map((item) => (
            <Card
              key={item.step}
              className="shadow-card hover:shadow-card-hover transition-shadow"
            >
              <CardContent className="flex gap-6 items-start p-6">
                <div className="flex-shrink-0 h-14 w-14 rounded-xl bg-primary flex items-center justify-center shadow-card">
                  <span className="text-2xl font-bold text-white">
                    {item.step}
                  </span>
                </div>
                <div>
                  <h3 className="text-xl font-bold text-foreground mb-2">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground">{item.description}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Index;
